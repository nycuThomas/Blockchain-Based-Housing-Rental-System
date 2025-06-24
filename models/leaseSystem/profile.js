const mongoose = require('mongoose');

const ProfileSchema = new mongoose.Schema({
    address: {
        require: true,
        type: String
    },
    name: {
        type: String
    },
    agency: {
        type: String
    },
    agent: {
        type: Boolean
    },
    pubkey: {
        type: String
    }
});

module.exports = ProfileSchema;