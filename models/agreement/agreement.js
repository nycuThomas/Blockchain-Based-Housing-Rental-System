const mongoose = require('mongoose');

const agreementSchema = new mongoose.Schema({
    landlordAddress: {
        require: true,
        type: String,
    },
    landlordPubkey: {
        type: String,
    },
    tenantAddress: {
        require: true,
        type: String,
    },
    tenantPubkey: {
        type: String,
    },
    houseOwner: {
        type: String
    },
    houseAddress: {
        type: String
    },
    area: {
        type: mongoose.Types.Decimal128
    },
    startDate: {
        type: String
    },
    endDate: {
        type: String
    },
    hashed: {
        require: true,
        type: String
    },
    state: {
        type: String
    },
    rent: {
        type: Number
    },
    content: {
        type: String
    },
    partyASign: {
        type: String
    },
    partyBSign: {
        type: String
    }
});


module.exports = agreementSchema;

