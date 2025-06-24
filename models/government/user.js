const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    userName: {
        require: true,
        type: String,
    },
    birth: {
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
    IDNumber: {
        require: true,
        type: String,
        unique: true
    },
    status: {
        type: Boolean,
        default: false
    },
    address: {
        type: String,
        default: '0x'
    },
    hashed: {
        type: String
    }
});


module.exports = UserSchema;

