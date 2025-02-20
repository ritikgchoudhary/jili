const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const winston = require('winston');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3002;

// Create a connection pool
const pool = mysql.createPool({
    host: 'localhost',
    user: 'ind99',
    password: 'ind99password',
    database: 'kubergames'
});

app.use(bodyParser.json());

// Create log directory if it doesn't exist
const logDir = path.join(__dirname, 'log');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

// Create winston loggers
const createLogger = (endpoint) => {
    return winston.createLogger({
        level: 'info',
        format: winston.format.json(),
        transports: [
            new winston.transports.File({ filename: path.join(logDir, `${endpoint}-incoming.log`) }),
            new winston.transports.File({ filename: path.join(logDir, `${endpoint}-outgoing.log`), level: 'info' }),
        ],
    });
};

// Middleware for logging incoming requests
const logIncoming = (endpoint) => (req, res, next) => {
    const logger = createLogger(endpoint);
    logger.info('Incoming request', { method: req.method, url: req.url, body: req.body });
    next();
};

// Middleware for logging outgoing responses
const logOutgoing = (endpoint) => (req, res, next) => {
    const logger = createLogger(endpoint);
    const originalSend = res.send;
    res.send = function (body) {
        logger.info('Outgoing response', { statusCode: res.statusCode, body });
        originalSend.apply(res, arguments);
    };
    next();
};

// Apply middleware to routes
app.use('/getUserBalance', logIncoming('getUserBalance'), logOutgoing('getUserBalance'));
app.use('/bet', logIncoming('bet'), logOutgoing('bet'));
app.use('/sessionBet', logIncoming('sessionBet'), logOutgoing('sessionBet'));
app.use('/cancelBet', logIncoming('cancelBet'), logOutgoing('cancelBet'));
app.use('/cancelSessionBet', logIncoming('cancelSessionBet'), logOutgoing('cancelSessionBet'));

// Error handling middleware
function handleError(res, error, message) {
    console.error(error);
    res.status(500).json({ error: message });
}

// Define endpoints
app.get('/getUserBalance', (req, res) => {
    const phone = req.query.userId;
    if (!phone) {
        return res.status(400).json({ error: 'Missing userid' });
    }

    pool.query('SELECT money FROM users WHERE phone = ?', [phone], (error, results) => {
        if (error) {
            return handleError(res, error, 'Failed to fetch balance');
        }
        if (results.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ balance: results[0].money });
    });
});

app.post('/bet', (req, res) => {
    const { userId, betAmount, winloseAmount } = req.body;
    if (!userId || betAmount === undefined || winloseAmount === undefined) {
        return res.status(400).json({ error: 'Missing parameter' });
    }

    pool.getConnection((err, connection) => {
        if (err) {
            return handleError(res, err, 'Database connection failed');
        }

        connection.beginTransaction((err) => {
            if (err) {
                connection.release();
                return handleError(res, err, 'Transaction failed');
            }

            connection.query('SELECT money FROM users WHERE phone = ?', [userId], (error, results) => {
                if (error) {
                    connection.rollback(() => connection.release());
                    return handleError(res, error, 'Failed to fetch current balance');
                }

                if (results.length === 0) {
                    connection.rollback(() => connection.release());
                    return res.status(404).json({ error: 'User not found' });
                }

                const currentBalance = results[0].money;
                const newBalance = currentBalance - betAmount + winloseAmount;

                connection.query('UPDATE users SET money = ? WHERE phone = ?', [newBalance, userId], (error) => {
                    if (error) {
                        connection.rollback(() => connection.release());
                        return handleError(res, error, 'Failed to update balance');
                    }

                    connection.commit((err) => {
                        if (err) {
                            connection.rollback(() => connection.release());
                            return handleError(res, err, 'Failed to commit transaction');
                        }

                        connection.release();
                        res.json({ newBalance });
                    });
                });
            });
        });
    });
});

app.post('/sessionBet', (req, res) => {
    const { userId, betAmount, winloseAmount, sessionId, type } = req.body;
    if (!userId || betAmount === undefined || winloseAmount === undefined || sessionId === undefined || type === undefined) {
        return res.status(400).json({ error: 'Missing parameter' });
    }

    pool.getConnection((err, connection) => {
        if (err) {
            return handleError(res, err, 'Database connection failed');
        }

        connection.beginTransaction((err) => {
            if (err) {
                connection.release();
                return handleError(res, err, 'Transaction failed');
            }

            connection.query('SELECT money FROM users WHERE phone = ?', [userId], (error, results) => {
                if (error) {
                    connection.rollback(() => connection.release());
                    return handleError(res, error, 'Failed to fetch current balance');
                }

                if (results.length === 0) {
                    connection.rollback(() => connection.release());
                    return res.status(404).json({ error: 'User not found' });
                }

                const currentBalance = results[0].money;
                let newBalance;
                if (type === 1) { // Bet
                    newBalance = currentBalance - betAmount;
                } else if (type === 2) { // Settle
                    newBalance = currentBalance + winloseAmount;
                } else {
                    connection.rollback(() => connection.release());
                    return res.status(400).json({ error: 'Invalid type' });
                }

                connection.query('UPDATE users SET money = ? WHERE phone = ?', [newBalance, userId], (error) => {
                    if (error) {
                        connection.rollback(() => connection.release());
                        return handleError(res, error, 'Failed to update balance');
                    }

                    connection.commit((err) => {
                        if (err) {
                            connection.rollback(() => connection.release());
                            return handleError(res, err, 'Failed to commit transaction');
                        }

                        connection.release();
                        res.json({ newBalance });
                    });
                });
            });
        });
    });
});

app.post('/cancelBet', (req, res) => {
    const { userId, betAmount, winloseAmount, round } = req.body;
    if (!userId || betAmount === undefined || winloseAmount === undefined || round === undefined) {
        return res.status(400).json({ error: 'Missing parameter' });
    }

    pool.getConnection((err, connection) => {
        if (err) {
            return handleError(res, err, 'Database connection failed');
        }

        connection.beginTransaction((err) => {
            if (err) {
                connection.release();
                return handleError(res, err, 'Transaction failed');
            }

            connection.query('SELECT money FROM users WHERE phone = ?', [userId], (error, results) => {
                if (error) {
                    connection.rollback(() => connection.release());
                    return handleError(res, error, 'Failed to fetch current balance');
                }

                if (results.length === 0) {
                    connection.rollback(() => connection.release());
                    return res.status(404).json({ error: 'User not found' });
                }

                const currentBalance = results[0].money;
                const newBalance = currentBalance + betAmount - winloseAmount;

                connection.query('UPDATE users SET money = ? WHERE phone = ?', [newBalance, userId], (error) => {
                    if (error) {
                        connection.rollback(() => connection.release());
                        return handleError(res, error, 'Failed to update balance');
                    }

                    connection.commit((err) => {
                        if (err) {
                            connection.rollback(() => connection.release());
                            return handleError(res, err, 'Failed to commit transaction');
                        }

                        connection.release();
                        res.json({ newBalance });
                    });
                });
            });
        });
    });
});

app.post('/cancelSessionBet', (req, res) => {
    const {
        userId, betAmount, winloseAmount, sessionId, type, preserve, offline
    } = req.body;

    if (!userId || betAmount === undefined || winloseAmount === undefined || sessionId === undefined || type === undefined) {
        return res.status(400).json({ error: 'Missing parameter' });
    }

    pool.getConnection((err, connection) => {
        if (err) {
            return handleError(res, err, 'Database connection failed');
        }

        connection.beginTransaction((err) => {
            if (err) {
                connection.release();
                return handleError(res, err, 'Transaction failed');
            }

            connection.query('SELECT money FROM users WHERE phone = ?', [userId], (error, results) => {
                if (error) {
                    connection.rollback(() => connection.release());
                    return handleError(res, error, 'Failed to fetch current balance');
                }

                if (results.length === 0) {
                    connection.rollback(() => connection.release());
                    return res.status(404).json({ error: 'User not found' });
                }

                const currentBalance = results[0].money;
                let newBalance;
                if (type === 1) { // Bet
                    newBalance = currentBalance - betAmount;
                } else if (type === 2) { // Settle
                    newBalance = currentBalance + winloseAmount;
                } else {
                    connection.rollback(() => connection.release());
                    return res.status(400).json({ error: 'Invalid type' });
                }

                if (preserve) {
                    newBalance += preserve;
                }
                if (offline) {
                    // Handle offline logic if needed
                }

                connection.query('UPDATE users SET money = ? WHERE phone = ?', [newBalance, userId], (error) => {
                    if (error) {
                        connection.rollback(() => connection.release());
                        return handleError(res, error, 'Failed to update balance');
                    }

                    connection.commit((err) => {
                        if (err) {
                            connection.rollback(() => connection.release());
                            return handleError(res, err, 'Failed to commit transaction');
                        }

                        connection.release();
                        res.json({ newBalance });
                    });
                });
            });
        });
    });
});

app.listen(port, () => {
    console.log(`Client server is running on port ${port}`);
});