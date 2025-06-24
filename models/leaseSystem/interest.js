const mongoose = require('mongoose');

const interestSchema = new mongoose.Schema({
    address: {
        require: true,
        type: String
    },
    ownerAddress: {
        type: String,
    },
    agentAddress: {
        type: String,
    },
    houseAddress: {
        type: String
    },
    willingness: {
        type: Boolean
    },
    agreement: {
        type: Boolean
    }
});

module.exports = interestSchema;