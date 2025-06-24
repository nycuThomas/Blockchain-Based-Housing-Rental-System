const mongoose = require('mongoose');

const Schema = new mongoose.Schema({
    ownerAddress: {
        require: true,
        type: String,
    },
    houseAddress: {
        require: true,
        type: String
    },
    area: {
        type: mongoose.Types.Decimal128
    },
    city: {
        type: String
    },
    type: {
        type: String
    },
    hashed: {
        type: String
    },
    title: {
        type: String
    },
    state: {
        type: String
    },
    agent: {
        type: String,
        default: "0x"
    },
    rent: {
        type: Number
    },
    rentHashed: {
        type: String
    },
    describe: {
        type: String
    }
});


module.exports = Schema;

