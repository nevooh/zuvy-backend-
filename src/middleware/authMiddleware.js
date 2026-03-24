const jwt = require('jsonwebtoken');

const protect = (req, res, next) => {
    // Check for token in the Authorization header
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

    if (!token) {
        return res.status(401).json({ message: "No token, authorization denied" });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // Adds {id, school_id, role} to the request
        next();
    } catch (err) {
        res.status(401).json({ message: "Token is not valid" });
    }
};

module.exports = { protect };