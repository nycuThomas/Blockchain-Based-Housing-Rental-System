const mongoose = require('mongoose');

const agencySchema = new mongoose.Schema({
    IDNumber: {
        type: String,
        unique: true
    },
    name: {
        type: String,
        require: true
    },
    date: {
        type: String,
        require: true
    }
});


module.exports = agencySchema;

