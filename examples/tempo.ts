import { ITIP20, IRolesAuth } from "./tip20.rs";
import { encodeFunctionData } from "viem";

export const transfer = encodeFunctionData({
  abi: ITIP20,
  functionName: "transfer",
  args: ["0x0000000000000000000000000000000000000001", 1_000_000n],
});

export const tokenAndRoles = [...ITIP20, ...IRolesAuth] as const;
