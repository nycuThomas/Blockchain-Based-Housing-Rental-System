const path = require('path')
const express = require('express');
const fs = require('fs');
const router = express.Router();
const openssl = require('openssl-nodejs');
const keccak256 = require('keccak256');

// session
const passport = require('passport');
const LocalStrategy = require('passport-local');

const config = JSON.parse(fs.readFileSync('./config/server_config.json', 'utf-8'));
const identityManager = JSON.parse(fs.readFileSync('./contracts/identityChain/IdentityManager.json', 'utf-8'));
const personalIdentity = JSON.parse(fs.readFileSync('./contracts/identityChain/PersonalIdentity.json', 'utf-8'));
const contract_address = config.contracts.identityManagerAddress;
const { Web3 } = require('web3');
const web3 = new Web3(new Web3.providers.HttpProvider(config.web3_provider));

const { ethers } = require('ethers');
const { decrypt, encrypt } = require("eth-sig-util");

const elliptic = require('elliptic')
const EC = elliptic.ec;
const ecdsaCurve = elliptic.curves['p256'];
const ecdsa = new EC(ecdsaCurve);

// HLF
const fabric_common = require("fabric-common");
const { Gateway, Wallets } = require('fabric-network');
const FabricCAServices = require('fabric-ca-client');
const { buildCAClient, enrollAdmin, registerAndEnrollUser, getAdminIdentity, buildCertUser } = require('../../util/CAUtil');
const { buildCCPOrg3, buildWallet } = require('../../util/AppUtil');

// hash function
var cryptoSuite = fabric_common.Utils.newCryptoSuite();
var hashFunction = cryptoSuite.hash.bind(cryptoSuite);

var caClient;
var leaseChannel, rentalAgreementInstance;

var wallet;
var gateway;
var adminUser;

const mongoose = require('mongoose');

module.exports = function (dbconnection) {
    const AgreementData = dbconnection.model('agreements', require('../../models/agreement/agreement'));

    let delay = async (ms) => {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    async function init() {
        //console.log('google router init()');
        await delay(3000);

        // build an in memory object with the network configuration (also known as a connection profile)
        const ccp = buildCCPOrg3();

        // build an instance of the fabric ca services client based on
        // the information in the network configuration
        caClient = buildCAClient(FabricCAServices, ccp, 'ca.org3.example.com');

        const walletPath = path.join(__dirname, '../../wallet/court');
        wallet = await buildWallet(Wallets, walletPath);

        mspOrg3 = 'Org3MSP';
        await enrollAdmin(caClient, wallet, mspOrg3);//remember to change ca url http to https

        //get ca admin to register and enroll user
        adminUser = await getAdminIdentity(caClient, wallet)

        // in a real application this would be done only when a new user was required to be added
        // and would be part of an administrative flow
        await registerAndEnrollUser(caClient, wallet, mspOrg3, 'court' /*, 'org2.department1'*/);


        // Create a new gateway instance for interacting with the fabric network.
        // In a real application this would be done as the backend server session is setup for
        // a user that has been verified.
        gateway = new Gateway();

        //console.log(JSON.stringify(gateway));
        await gateway.connect(ccp, {
            wallet,
            identity: 'court',
            discovery: { enabled: true, asLocalhost: true }
        });

        leaseChannel = await gateway.getNetwork('lease-channel');
        rentalAgreementInstance = await leaseChannel.getContract('RentalAgreement');
    }
    init();

    var isAuthenticated = function (req, res, next) {
        // console.log('isAuthenticated : ' + req.isAuthenticated());
        if (req.isAuthenticated()) {
            next();
        } else {
            req.flash('info', 'Login first.');
            res.redirect('/LeaseSystem/login');
        }
    };

    function verifiedSignature(signature, pubkey, data) {
        var publickeyObject = ecdsa.keyFromPublic(pubkey, 'hex');
        return publickeyObject.verify(data, Buffer.from(signature));
    }

    // owner create a agreement to certain tenant
    router.post("/createAgreement", isAuthenticated, async (req, res) => {
        const address = req.session.address;
        let { houseOwner, houseAddress,
            createrPubkey, tenantAddress, tenantPubkey, agentAddress,
            houseArea, startDate, endDate, rent, content } = req.body;
        // console.log(req.body);

        if (address != houseOwner && address != agentAddress) {
            return res.send({ error: "address error." });
        }

        // let encryptString = address.toString() + tenantAddress.toString() + houseAddress.toString() + startDate.toString();
        let hashed; // = keccak256(encryptString).toString('hex');

        try {
            const agreementData = new AgreementData({
                landlordAddress: address,
                landlordPubkey: createrPubkey,
                tenantAddress: tenantAddress,
                tenantPubkey: tenantPubkey,
                houseOwner: houseOwner,
                houseAddress: houseAddress,
                area: houseArea,
                startDate: startDate,
                endDate: endDate,
                state: "unsigned",
                rent: rent,
                content: content
            })
            agreementData.hashed = keccak256(agreementData.toString()).toString("hex");
            hashed = agreementData.hashed;
            // console.log(agreementData);
            await agreementData.save();
        } catch (error) {
            console.log(error);
            return res.send({ msg: "save data error.", error: error });
        }

        try {
            let PartyAkey = createrPubkey;
            let PartyBkey = tenantPubkey;

            let result = await rentalAgreementInstance.submitTransaction('CreateAgreement', PartyAkey, PartyBkey, houseAddress, hashed);
            console.log(result.toString());
            return res.send({ msg: "create success.", hashed: hashed });
        } catch (error) {
            console.log(error);
            return res.send({ msg: "create fail.", error: error });
        }
    })

    // view the agreement data in the database, need to create first
    router.post('/agreementPage', isAuthenticated, async (req, res) => {
        const address = req.session.address;
        const { ownerAddress, tenantAddress, houseAddress } = req.body;
        let agreement = await AgreementData.findOne({ landlordAddress: ownerAddress, tenantAddress: tenantAddress, houseAddress: houseAddress });
        if (!agreement) {
            agreement = await AgreementData.findOne({ houseOwner: ownerAddress, tenantAddress: tenantAddress, houseAddress: houseAddress });
        }

        if (!agreement) {
            res.send({ msg: "The agreement is not exist, please create agreement first." });
        }
        else {
            res.send({ url: `/leaseSystem/agreement/agreementPage?owner=${agreement.landlordAddress}&tenant=${tenantAddress}&house=${houseAddress}` });
        }
    });

    router.get("/agreementPage", async (req, res) => {
        const address = req.session.address;
        const owner = req.query.owner;
        const tenant = req.query.tenant;
        const house = req.query.house;

        let agreement = await AgreementData.findOne({ landlordAddress: owner, tenantAddress: tenant, houseAddress: house });
        res.render('leaseSystem/agreement/agreementPage', { address: address, agreement: agreement, contract_address: contract_address });
    })

    // owner and tenant sign the agreement
    router.post("/signAgreement", isAuthenticated, async (req, res) => {
        let { address, ownerAddress, tenantAddress, houseAddress } = req.body;
        let signature = req.body['signature[]'];

        let type;
        try {
            let agreement = await AgreementData.findOne({ landlordAddress: ownerAddress, tenantAddress: tenantAddress, houseAddress: houseAddress });
            if (!agreement) {
                let error = "error: agreement not exist.";
                throw error;
            }

            if (address == ownerAddress) {
                type = "PartyA";
                if (verifiedSignature(signature, agreement.landlordPubkey, agreement.hashed)) {
                    let result = await rentalAgreementInstance.submitTransaction('SignAgreement', agreement.landlordPubkey, agreement.tenantPubkey, agreement.hashed, signature, type);
                    console.log(result.toString());
                    await AgreementData.findOneAndUpdate({ landlordAddress: ownerAddress, tenantAddress: tenantAddress, houseAddress: houseAddress },
                        { partyASign: signature.toString() });
                    return res.send({ msg: "sign success." });
                }
            }
            else if (address == tenantAddress) {
                type = "PartyB";
                if (verifiedSignature(signature, agreement.tenantPubkey, agreement.hashed)) {
                    let result = await rentalAgreementInstance.submitTransaction('SignAgreement', agreement.landlordPubkey, agreement.tenantPubkey, agreement.hashed, signature, type);
                    console.log(result.toString());
                    await AgreementData.findOneAndUpdate({ landlordAddress: ownerAddress, tenantAddress: tenantAddress, houseAddress: houseAddress },
                        { partyBSign: signature.toString() });
                    return res.send({ msg: "sign success." });
                }
            }
            else {
                let error = `error: address ${address} error.`;
                throw error;
            }
        } catch (error) {
            console.log(error);
            return res.send({ msg: `sign fail:${error}` });
        }
        return res.send({ msg: "sign fail." });
    })

    router.post("/verifySign", async (req, res) => {
        let { ownerAddress, tenantAddress, houseAddress } = req.body;
        let agreement = await AgreementData.findOne({ landlordAddress: ownerAddress, tenantAddress: tenantAddress, houseAddress: houseAddress });
        let result = await rentalAgreementInstance.submitTransaction('VerifyAgreementSign', agreement.landlordPubkey, agreement.hashed, houseAddress);
        console.log(result.toString());
        return res.send({ msg: result.toString() });
    })

    /*  For Testing
    // Evaluation leaseSystem/agreement/test
    router.post("/test/CreateAgreement", async (req, res) => {
        let { houseAddress, PartyAkey, PartyBkey, hashed } = req.body;

        // let encryptString = address.toString() + tenantAddress.toString() + houseAddress.toString() + startDate.toString();
        // let hashed = keccak256(encryptString).toString('hex');

        try {
            // let PartyAkey = createrPubkey;
            // let PartyBkey = tenantPubkey;

            let result = await rentalAgreementInstance.submitTransaction('TestCreateAgreement', PartyAkey, PartyBkey, houseAddress, hashed);
            // console.log(result.toString());
            return res.status(200).send({ msg: "success." });
        } catch (error) {
            // console.log(error);
            return res.status(200).send({ msg: "error." });
        }
    })

    router.post("/test/SignAgreement", async (req, res) => {
        let { PartyAkey, PartyBkey, hashed, signature, type } = req.body;
        // let signature = req.body['signature[]'];

        // let type = "PartyA";
        try {
            // let agreement = await AgreementData.findOne({ landlordAddress: ownerAddress, tenantAddress: tenantAddress, houseAddress: houseAddress });
            // if (!agreement) {
            //     let error = "error: agreement not exist.";
            //     throw error;
            // }
            // if (verifiedSignature(signature, pubkey, hashed)) {
            let result = await rentalAgreementInstance.submitTransaction('TestSignAgreement', PartyAkey, PartyBkey, hashed, signature, type);
            return res.status(200).send({ msg: "success." });
            // }

        } catch (error) {
            console.log(error);
            return res.status(400).send({ msg: "error." });
        }
        // return res.status(400).send({ msg: "error." });
    })

    router.post("/test/VerifyAgreementSign", async (req, res) => {
        let { PartyAkey, hashed, houseAddress } = req.body;
        // let agreement = await AgreementData.findOne({ landlordAddress: ownerAddress, tenantAddress: tenantAddress, houseAddress: houseAddress });
        let result = await rentalAgreementInstance.submitTransaction('TestVerifyAgreementSign', PartyAkey, hashed, houseAddress);
        // console.log(result.toString());
        return res.send({ msg: result.toString() });
    })

    router.post("/test/TestSetting", async (req, res) => {
        let { houseAddress, PartyAkey, PartyBkey, hashed, signature } = req.body;
        // console.log(req.body);
        
        // let encryptString = address.toString() + tenantAddress.toString() + houseAddress.toString() + startDate.toString();
        // let hashed = keccak256(encryptString).toString('hex');

        try {
            // let PartyAkey = createrPubkey;
            // let PartyBkey = tenantPubkey;

            let result = await rentalAgreementInstance.submitTransaction('TestSetting', PartyAkey, PartyBkey, houseAddress, hashed, signature);
            // console.log(result.toString());
            return res.status(200).send({ msg: "success." });
        } catch (error) {
            console.log(error);
            return res.status(200).send({ msg: "error." });
        }
    })
    */


    return router;
}