//SPDX-License-Identifier: MIT
pragma solidity >=0.4.22 <=0.8.19;
import "./PersonalIdentity.sol";
pragma experimental ABIEncoderV2;

contract IdentityManager {
    constructor() {
        for (uint i = 0; i < _orgsArr.length; i++) {
            _orgs[_orgsArr[i]] = true;
        }
    }
    modifier onlyOrg {
        require(_orgs[msg.sender],"Only organization administrator can call.");
        _;
    }
    struct UserInfo {
        address personalIdentityAddress;   // address of access control manager
        address userAddress;            // binding addrss
    }

    struct BindInfo {
        string hashed;
        uint userType;
    }

    address[] _orgsArr = [0xe092b1fa25DF5786D151246E492Eed3d15EA4dAA];
    mapping(address => bool) _orgs;
    mapping(string => UserInfo) _uniqueIdenity; // hash(id) map userAcc
    mapping(string => bool) _uniqueState; // hash(id) is added by orgs  (addUser function)
    mapping(address => BindInfo) _bindUsers; // address map hash(id)
    mapping(string => bool) _bindState; // hash(id) not bind
  

    //event AddUserEvent(address orgAddress, uint status);
    //event BindUserAccountEvent(address orgAddress, address userAccount, string hashed);

    function addUser(string memory hashed) external onlyOrg{
        if(!_uniqueState[hashed]) {
            _uniqueState[hashed] = true;
            UserInfo memory info = UserInfo(
                                        address(0),
                                        address(0)
                                    );
            _uniqueIdenity[hashed] = info;
        }
        
    }

    function bindAccount(string memory hashed,address userAddress, uint userType) external onlyOrg{
        //bytes memory tempEmptyStringTest = bytes(emptyStringTest);
        require(bytes(_bindUsers[userAddress].hashed).length == 0,
                "This address already binded.");
        require(_bindState[hashed] == false,
                "This UniqueId already binded");
        require(_uniqueState[hashed],
                "UniqueId invalid."); // need execute add user first.
                
        _bindUsers[userAddress].hashed = hashed;    // for record address <==> hashed id
        _bindUsers[userAddress].userType = userType;
        _bindState[hashed] = true;           // for confirm this hashed id already bind before

        // create contract and transfer ownership to user himself
        PersonalIdentity personalIdentity = new PersonalIdentity();
        personalIdentity.transferOwnership(userAddress);
        
        // update user info
        _uniqueIdenity[hashed].personalIdentityAddress = address(personalIdentity);
        _uniqueIdenity[hashed].userAddress = userAddress;

    }

    function getAccessManagerAddress(address userAddress) external view returns (address) {
        return _uniqueIdenity[_bindUsers[userAddress].hashed].personalIdentityAddress;
    }

    function getId() external view returns (string memory) {
        return _bindUsers[msg.sender].hashed;
    }

    function getUserType() external view returns (uint){
        return _bindUsers[msg.sender].userType;
    }
}
