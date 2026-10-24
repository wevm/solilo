// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

interface Base {
    function inherited(address who) external view returns (uint256);
}

interface Features is Base {
    struct Position { address owner; uint128 amount; bytes32[] tags; }
    event Changed(address indexed owner, uint256 amount);
    error Denied(address caller, uint256 required);
    function quote(uint256 amount) external view returns (uint256);
    function quote(address owner) external view returns (uint256);
    function positions(Position[] calldata input) external pure returns (Position memory);
}
