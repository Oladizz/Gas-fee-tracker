require('dotenv').config(); // Load environment variables from .env file
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch'); // Using node-fetch for compatibility
const { ethers } = require('ethers');

const app = express();
const port = process.env.PORT || 3000; // Use port 3000 or environment variable

// --- Configuration ---
const { BASESCAN_API_KEY } = process.env;
const BASESCAN_API_URL = 'https://api.basescan.org/api';
const BASE_RPC_URL = process.env.BASE_RPC_URL || 'https://base.publicnode.com'; // Fallback RPC

// --- Initialize Web3 Provider ---
let provider;
try {
    provider = new ethers.JsonRpcProvider(BASE_RPC_URL);
    provider
        .getBlockNumber() // Test connection
        .then(() => console.log(`Connected to Base RPC: ${BASE_RPC_URL}`))
        .catch((err) =>
            console.error(
                `Failed to connect to Base RPC at ${BASE_RPC_URL}:`,
                err,
            ),
        );
} catch (err) {
    console.error(
        `Error initializing ethers provider with URL ${BASE_RPC_URL}:`,
        err,
    );
    provider = null; // Ensure provider is null if initialization fails
}

// --- Global Error Handlers ---
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Application specific logging, throwing an error, or other logic here
    // Consider exiting the process gracefully depending on the error severity
    // process.exit(1); // Optional: exit if the error is critical
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // Application specific logging
    // Consider exiting the process gracefully
    // process.exit(1); // Optional: exit if the error is critical
});

// --- Middleware ---
// Configure CORS - Adjust origin in production!
// For development, allowing * is easiest. Restrict to your frontend's origin for production.
const corsOptions = {
    origin: '*', // Allow requests from any origin (for development)
    // For production, change '*' to your frontend domain, e.g., 'https://your-app.com'
    // If running frontend on localhost:5500 (Live Server), use 'http://localhost:5500'
    methods: ['GET'], // Only allow GET requests
    allowedHeaders: ['Content-Type'],
};
app.use(cors(corsOptions));

app.use(express.json()); // For parsing application/json (not strictly needed for GET requests here)

// Middleware to check for API key
app.use('/api/*', (req, res, next) => {
    if (!BASESCAN_API_KEY) {
        console.error('API Key is missing!');
        return res.status(500).json({
            status: '0',
            message: 'BASE SCAN API key is not set in environment variables.',
        });
    }
    return next(); // Continue to the route handler
});

// --- Helper Function for BaseScan API Calls ---
async function callBaseScanApi(params) {
    const url = new URL(BASESCAN_API_URL);
    url.searchParams.append('apikey', BASESCAN_API_KEY);
    Object.keys(params).forEach((key) => {
        if (params[key] !== undefined && params[key] !== null) {
            url.searchParams.append(key, params[key]);
        }
    });

    const logUrl = new URL(url.toString()); // Clone the URL
    logUrl.searchParams.delete('apikey'); // Remove API key for logging
    console.log(`Calling BaseScan API: ${logUrl.toString()}`);

    try {
        const response = await fetch(url);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
                `HTTP error! status: ${response.status}, body: ${errorText}`,
            );
        }
        const data = await response.json();

        // BaseScan often returns status '0' with a message even on successful HTTP
        // If status is '0', it's often an API-level error or "No transactions found"
        if (data.status === '0') {
            // Check if it's just "No transactions found" which is not a critical error
            if (
                data.message &&
                data.message.includes('No transactions found')
            ) {
                console.log(`BaseScan Info: ${data.message}`);
                return data; // Return the { status: '0', message: '...', result: [] } structure
            }
            console.error(
                `BaseScan API returned status 0: ${data.message} - ${data.result}`,
            );
            throw new Error(`BaseScan API Error: ${data.message}`);
        }

        return data; // Return the full response, including status and result
    } catch (error) {
        console.error('Error during BaseScan API fetch:', error);
        throw error; // Re-throw the error
    }
}

// --- API Endpoints for Frontend ---

// Fetch balance
app.get('/api/balance', async (req, res) => {
    const { address } = req.query;
    if (!address) {
        return res
            .status(400)
            .json({ status: '0', message: 'Address parameter is required.' });
    }

    try {
        const params = {
            module: 'account',
            action: 'balance',
            address,
            tag: 'latest',
        };
        const data = await callBaseScanApi(params);
        // BaseScan balance endpoint returns the balance string directly in 'result'
        if (data.status === '1') {
            return res.json({ status: '1', result: data.result });
        }
        // Forward BaseScan's status 0 response
        return res.status(400).json(data); // Or 500 depending on error type
    } catch (error) {
        return res.status(500).json({
            status: '0',
            message: `Failed to fetch balance: ${error.message}`,
        });
    }
});

// Fetch normal and internal transactions
app.get('/api/transactions', async (req, res) => {
    const { address } = req.query;
    if (!address) {
        return res
            .status(400)
            .json({ status: '0', message: 'Address parameter is required.' });
    }

    try {
        // Fetch Normal Transactions
        const normalTxParams = {
            module: 'account',
            action: 'txlist',
            address,
            startblock: 0,
            endblock: 99999999,
            sort: 'asc',
        };
        const normalTxResponse = await callBaseScanApi(normalTxParams);
        const normalTxData =
            normalTxResponse.status === '1' &&
            Array.isArray(normalTxResponse.result)
                ? normalTxResponse.result
                : [];
        const normalTx = normalTxData.map((tx) => ({
            ...tx,
            type: 'Normal',
        })); // Add type for differentiation

        // Fetch Internal Transactions
        const internalTxParams = {
            module: 'account',
            action: 'txlistinternal',
            address,
            startblock: 0,
            endblock: 99999999,
            sort: 'asc',
        };
        const internalTxResponse = await callBaseScanApi(internalTxParams);
        const internalTxData =
            internalTxResponse.status === '1' &&
            Array.isArray(internalTxResponse.result)
                ? internalTxResponse.result
                : [];
        const internalTx = internalTxData.map((tx) => ({
            ...tx,
            type: 'Internal',
        })); // Add type for differentiation

        // Combine and sort by timestamp
        const allTransactions = [...normalTx, ...internalTx];
        allTransactions.sort(
            (a, b) => parseInt(a.timeStamp, 10) - parseInt(b.timeStamp, 10),
        );

        return res.json({ status: '1', result: allTransactions });
    } catch (error) {
        return res.status(500).json({
            status: '0',
            message: `Failed to fetch transactions: ${error.message}`,
        });
    }
});

// Fetch token transfers (ERC20, optionally ERC721)
app.get('/api/token-transfers', async (req, res) => {
    const { address } = req.query;
    if (!address) {
        return res
            .status(400)
            .json({ status: '0', message: 'Address parameter is required.' });
    }

    try {
        // Fetch ERC20 Transfers
        const erc20TxParams = {
            module: 'account',
            action: 'tokentx',
            address,
            startblock: 0,
            endblock: 99999999,
            sort: 'asc',
        };
        const erc20TxResponse = await callBaseScanApi(erc20TxParams);
        const erc20TxData =
            erc20TxResponse.status === '1' &&
            Array.isArray(erc20TxResponse.result)
                ? erc20TxResponse.result
                : [];
        const erc20Tx = erc20TxData.map((tx) => ({
            ...tx,
            tokenType: 'ERC20',
        }));

        // Fetch ERC721 Transfers (Optional - uncomment if needed)
        // const erc721TxParams = {
        //     module: 'account',
        //     action: 'tokennfttx',
        //     address: address,
        //     startblock: 0,
        //     endblock: 99999999,
        //     sort: 'asc'
        // };
        // const erc721TxResponse = await callBaseScanApi(erc721TxParams);
        // const erc721Tx = (erc721TxResponse.status === '1' && Array.isArray(erc721TxResponse.result)) ? erc721TxResponse.result : [];
        // erc721Tx.forEach(tx => tx.tokenType = 'ERC721');

        // Combine and sort by timestamp
        // const allTokenTransfers = [...erc20Tx, ...erc721Tx]; // Include erc721Tx if fetched
        const allTokenTransfers = [...erc20Tx]; // Only ERC20 for now
        allTokenTransfers.sort(
            (a, b) => parseInt(a.timeStamp, 10) - parseInt(b.timeStamp, 10),
        );

        return res.json({ status: '1', result: allTokenTransfers });
    } catch (error) {
        return res.status(500).json({
            status: '0',
            message: `Failed to fetch token transfers: ${error.message}`,
        });
    }
});

// Resolve ENS Name to Address
app.get('/api/ens/resolve', async (req, res) => {
    const { name } = req.query;
    if (!name) {
        return res
            .status(400)
            .json({ status: '0', message: 'Name parameter is required.' });
    }
    if (!provider) {
        return res
            .status(500)
            .json({ status: '0', message: 'Web3 provider not initialized.' });
    }

    try {
        console.log(`Attempting to resolve ENS: ${name}`);
        const address = await provider.resolveName(name); // Returns checksum address or null
        console.log(`Resolved ${name} to ${address}`);
        return res.json({ status: '1', result: { address } });
    } catch (error) {
        console.error(`Error resolving ENS ${name}:`, error);
        // Common error for ENS not found might not throw, but return null.
        // If it throws, send an error response.
        return res.status(500).json({
            status: '0',
            message: `Failed to resolve ENS: ${error.message}`,
        });
    }
});

// Validate Address Format
app.get('/api/address/validate', async (req, res) => {
    const { address } = req.query;
    if (!address) {
        return res
            .status(400)
            .json({ status: '0', message: 'Address parameter is required.' });
    }
    // Ethers validate method doesn't need a provider connection
    const isValid = ethers.isAddress(address); // Correct method in ethers v6
    console.log(`Validating address ${address}: ${isValid}`);
    return res.json({ status: '1', result: { isValid } });
});

// Serve static frontend files (Optional, but convenient for development)
// If you put your index.html, style.css, script.js in a 'public' folder
// app.use(express.static('public'));
// Then you can navigate to http://localhost:3000 in your browser.
// If not using this, just open index.html directly and ensure CORS is configured correctly.

// --- Start Server ---
app.listen(port, () => {
    console.log(`Base Gas Tracker Backend listening on port ${port}`);
    console.log(
        `Access frontend via file://${__dirname}/../index.html or serve it separately.`,
    );
});
