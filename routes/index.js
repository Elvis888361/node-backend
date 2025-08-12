const express = require('express');
const invoices= require("./api/invoices")

const router = express.Router();

// Define a GET route
router.use("/invoices",invoices)

module.exports = router;