'use strict';

// Threads integration removed. This endpoint is disabled.
module.exports = (req, res) => res.status(410).json({ error: 'Threads integration removed.' });
