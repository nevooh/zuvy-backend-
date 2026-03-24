const jwt = require('jsonwebtoken');

const protectMaster = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
        ? authHeader.split(' ')[1]
        : null;

    if (!token) {
        return res.status(401).json({ message: 'No token' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (decoded.role !== 'MASTER_ADMIN') {
            return res.status(403).json({ message: 'Forbidden' });
        }

        req.master = decoded;
        next();
    } catch (err) {
        res.status(401).json({ message: 'Invalid token' });
    }
};

module.exports = { protectMaster };
