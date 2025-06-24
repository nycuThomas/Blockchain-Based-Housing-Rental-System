const mongoose = require('mongoose');

const DataSchema = new mongoose.Schema({
    address: {
        require: true,
        type: String,
    },
    pubkey: {
        require: true,
        type: String,
    },
    job: {
        type: String
    },
    salary: {
        type: Number
    },
    deposit: {
        type: Number
    }
});


module.exports = DataSchema;

