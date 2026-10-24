import { createPublicClient, getContract, http } from "viem";
import { foundry } from "viem/chains";
import { Counter } from "./Counter.sol";

const client = createPublicClient({ chain: foundry, transport: http() });
export const counter = getContract({
  abi: Counter,
  address: "0x0000000000000000000000000000000000000001", // Replace with your deployed address.
  client,
});

export async function readNumber(): Promise<bigint> {
  return counter.read.number();
}
