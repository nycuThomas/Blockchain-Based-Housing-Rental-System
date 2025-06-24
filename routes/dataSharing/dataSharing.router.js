// gov use, to cert user estate and agent
const path = require('path')
const express = require('express');
const fs = require('fs');
const router = express.Router();

// session
const passport = require('passport');
const LocalStrategy = require('passport-local');

const config = JSON.parse(fs.readFileSync('./config/server_config.json', 'utf-8'));
const contract_address = config.contracts.identityManagerAddress;
const identityManger = JSON.parse(fs.readFileSync('./contracts/identityChain/IdentityManager.json', 'utf-8'));
const { Web3 } = require('web3');
const web3 = new Web3(new Web3.providers.HttpProvider(config.web3_provider));
const keccak256 = require('keccak256');
const mongoose = require('mongoose');

//fabric SDK and Util
const fabric_common = require("fabric-common");
const { Gateway, Wallets } = require('fabric-network');
const FabricCAServices = require('fabric-ca-client');
const { buildCAClient, enrollAdmin, registerAndEnrollUser, getAdminIdentity, buildCertUser } = require('../../util/CAUtil');
const { buildCCPOrg4, buildWallet } = require('../../util/AppUtil');

const require_signature = "LeaseSystem?nonce:778";

var caClient;
var accChannel, accInstance;
var leaseChannel, estatePublishInstance;
var wallet;
var gateway;
var adminUser;



module.exports = function (dbconnection) {
    const PersonalData = dbconnection.model('personalDatas', require('../../models/dataSharing/personalData'));

    let delay = async (ms) => {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    async function init() {
        //console.log('google router init()');
        await delay(4000);

        // build an in memory object with the network configuration (also known as a connection profile)
        const ccp = buildCCPOrg4();

        // build an instance of the fabric ca services client based on
        // the information in the network configuration
        caClient = buildCAClient(FabricCAServices, ccp, 'ca.org4.example.com');

        const walletPath = path.join(__dirname, '../../wallet/NTB');
        wallet = await buildWallet(Wallets, walletPath);

        mspOrg4 = 'Org4MSP';
        await enrollAdmin(caClient, wallet, mspOrg4);//remember to change ca url http to https

        //get ca admin to register and enroll user
        adminUser = await getAdminIdentity(caClient, wallet)

        // in a real application this would be done only when a new user was required to be added
        // and would be part of an administrative flow
        await registerAndEnrollUser(caClient, wallet, mspOrg4, 'NTB' /*, 'org1.department1'*/);


        // Create a new gateway instance for interacting with the fabric network.
        // In a real application this would be done as the backend server session is setup for
        // a user that has been verified.
        gateway = new Gateway();

        //console.log(JSON.stringify(gateway));
        await gateway.connect(ccp, {
            wallet,
            identity: 'NTB',
            discovery: { enabled: true, asLocalhost: true }
        });

        accChannel = await gateway.getNetwork('acc-channel');
        accInstance = await accChannel.getContract('AccessControlManager');

        leaseChannel = await gateway.getNetwork('lease-channel');
        estatePublishInstance = await leaseChannel.getContract('EstatePublish');
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

    router.get('/authorizeIfo', isAuthenticated, async (req, res) => {
        const address = req.session.address;
        const pubkey = req.session.pubkey;
        let localData = {};
        try {
            localData = await PersonalData.findOne({ address: address });
            if (!localData) {
                localData = new PersonalData({ address: address, pubkey: pubkey });
                localData.save();
            }
        } catch (error) {
            console.log(error);
        }

        res.render('leaseSystem/dataSharing/upload', {
            address: address, pubkey: pubkey, tenantData: localData, contract_address: contract_address
        });
    });

    router.post('/request', isAuthenticated, async (req, res) => {
        // const address = req.session.address;
        // const pubkey = req.session.pubkey;
        const { tenantAddress, houseAddress } = req.body;
        res.send({ url: 'dataSharing/request?tenant=' + tenantAddress + '&house=' + houseAddress });
    });

    router.get('/request', isAuthenticated, async (req, res) => {
        const address = req.session.address;
        const pubkey = req.session.pubkey;
        const tenant = req.query.tenant;
        const house = req.query.house;

        let restrictionBuffer = await estatePublishInstance.evaluateTransaction('GetListingCondiction', pubkey, house);
        let restriction = JSON.parse(restrictionBuffer.toString());
        console.log(restriction);

        res.render('leaseSystem/dataSharing/request', {
            address: address, pubkey: pubkey, tenant: tenant, house: house,
            restriction: restriction, contract_address: contract_address
        });
    });

    router.post('/saveData', isAuthenticated, async (req, res) => {
        const address = req.session.address;
        const pubkey = req.session.pubkey;
        const { jobInput, salaryInput, depositInput, ownerAddress, ownerPubkey, houseAddress } = req.body;

        let localData;
        try {
            localData = await PersonalData.findOne({ address: address });
            if (!localData) {
                localData = new PersonalData({ address: address, pubkey: pubkey, job: jobInput, salary: salaryInput, deposit: depositInput });
                localData.save();
            }
            else {
                localData = await PersonalData.findOneAndUpdate({ address: address },
                    { job: jobInput, salary: salaryInput, deposit: depositInput }, { new: true });
            }
            res.render('leaseSystem/dataSharing/upload', {
                address: address, pubkey: pubkey, owner: ownerAddress, ownerPubkey: ownerPubkey,
                house: houseAddress, tenantData: localData, contract_address: contract_address
            });
        } catch (error) {
            console.log(error);
            // res.send({ msg: 'save data error.' });
        }
    })

    // router.post('/updatePermission', isAuthenticated, async (req, res) => {
    //     const address = req.session.address;
    //     const { name, email, job, salary, deposit } = req.body;
    //     const { userPubkey } = req.body;
    //     let attributes = {
    //         "name": name,
    //         "email": email,
    //         "job": job,
    //         "salary": salary,
    //         "deposit": deposit
    //     }
    //     let attString = JSON.stringify(attributes);

    //     // save to chain offline sign
    //     try {
    //         // userPubkey, dataRequester, attribute, endTime
    //         let result = await accInstance.submitTransaction('UpdatePermission', userPubkey, attString, "endTime");
    //         console.log(result.toString());
    //         return res.send({ msg: "update success." });

    //         // const digest = await createTransaction(address.toLowerCase(), 'UpdatePermission', userPubkey, dataRequester, attString, "endTime");
    //         // return res.send({ 'digest': digest });
    //     } catch (error) {
    //         console.log(error);
    //         return res.send({ msg: "update error." });
    //     }
    // });

    router.post('/revokePermission', isAuthenticated, async (req, res) => {
        const { userPubkey, dataRequester, attribute } = req.body;

        // save to chain
        try {
            // userPubkey, dataRequester, attribute
            let result = await accInstance.submitTransaction('RevokePermission', userPubkey, dataRequester, attribute);
            console.log(result.toString());
            return res.send({ msg: "success." });
        } catch (error) {
            console.log(error);
            return res.send({ msg: "error." });
        }
    });


    router.post('/conditionReview', isAuthenticated, async (req, res) => {
        const address = req.session.address;
        const pubkey = req.session.pubkey;
        const { tenantAddress, house } = req.body;
        // const { name, email, job, salary, deposit } = req.body;
        // attributes.name = name; attributes.email = email; attributes.job = job; attributes.salary = salary; attributes.deposit = deposit;

        let restrictionBuffer = await estatePublishInstance.evaluateTransaction('GetListingCondiction', pubkey, house);
        let restriction = JSON.parse(restrictionBuffer.toString());
        // console.log(restriction);

        // ConfirmMutiPermission(ctx, dataRequester, userPubkey, attributes)
        // let permitBuffer = await accInstance.evaluateTransaction('ConfirmMutiPermission', pubkey, tenantData.pubkey, attributes);
        let tenantData, permitBuffer, permitJson;
        try {
            tenantData = await PersonalData.findOne({ address: tenantAddress });
            permitBuffer = await accInstance.evaluateTransaction('GetPermission', tenantData.pubkey, pubkey);
            permitJson = JSON.parse(permitBuffer.toString());
        } catch (error) {
            console.log(error);
            return res.send({ msg: "The tenant does not set the personal data.", "data": {} });
        }

        let data = {};
        Object.keys(restriction).forEach(async restrictionKey => {
            Object.keys(permitJson).forEach(async key => {
                if (key == restrictionKey && permitJson[key].access == "true") {
                    switch (key) {
                        case "job":
                            if (restriction[restrictionKey] == tenantData[key])
                                data[restrictionKey] = "pass";
                            else
                                data[restrictionKey] = "fail";
                            break;
                        case "salary":
                            if (restriction[restrictionKey] <= tenantData[key])
                                data[restrictionKey] = "pass";
                            else
                                data[restrictionKey] = "fail";
                            break;
                        case "deposit":
                            if (restriction[restrictionKey] <= tenantData[key])
                                data[restrictionKey] = "pass";
                            else
                                data[restrictionKey] = "fail";
                            break;
                        default:
                            break;
                    }

                }
            })
            if (data[restrictionKey] == undefined) {
                data[restrictionKey] = "permission deny";
            }
        })
        // console.log(data);

        return res.send({ msg: "done", "data": data });
    });


    // Evaluation leaseSystem/dataSharing/test
    /*
    router.post('/test/GetPermission', async (req, res) => {
        const { tenantPubkey, landlordPubkey } = req.body;
        try {
            let permitBuffer = await accInstance.evaluateTransaction('GetPermission', tenantPubkey, landlordPubkey);
            return res.status(200).send({ msg: "success." });
        } catch (error) {
            console.log(error);
            return res.status(400).send({ msg: "error." });
        }
    });

    router.post('/test/GetListingCondiction', async (req, res) => {
        const { pubkey, house } = req.body;
        try {
            let restrictionBuffer = await estatePublishInstance.evaluateTransaction('GetListingCondiction', pubkey, house);
            return res.status(200).send({ msg: "success." });
        } catch (error) {
            console.log(error);
            return res.status(400).send({ msg: "error." });
        }
    });
    */
    return router;
}