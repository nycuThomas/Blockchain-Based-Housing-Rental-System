const mongoose = require('mongoose');

const realEstateSchema = new mongoose.Schema({
    ownerName: {
        require: true,
        type: String,
    },
    IDNumber: {
        require: true,
        type: String,
    },
    houseAddress: {
        require: true,
        type: String,
    },
    area: {
        require: true,
        type: mongoose.Types.Decimal128
    },
    date: {
        type: String
    }
});


module.exports = realEstateSchema;

