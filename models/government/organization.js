const mongoose = require('mongoose');

const OrgSchema = new mongoose.Schema({
    organizationName: {
        require: true,
        type: String,
    },
    personInCharge: {
        require: true,
        type: String
    },
    email: {
        require: true,
        type: String
    },
    phone: {
        require: true,
        type: String
    },
    UniformNumbers: {
        require: true,
        type: String,
        unique: true
    },
    type: {
        require: true,
        type: String
    },
    status: {
        type: Boolean,
        default: false
    },
    address: {
        type: String,
        default: '0x'
    },
    pubkey: {
        type: String,
        default: '0x'
    },
    hashed: {
        type: String
    }
});


module.exports = OrgSchema;

