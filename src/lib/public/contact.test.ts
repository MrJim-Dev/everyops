import { describe, expect, it } from "vitest";
import { f } from "@/lib/catalog/define";
import { visitorContactIds } from "./resolve";

describe("who is booking", () => {
  it("requires the form's name and a way to reach the visitor, not their payment reference", () => {
    const fields = [
      f.text("player_name", "Player Name"),
      f.text("phone", "Phone"),
      f.text("email", "Email"),
      f.text("payment_ref", "Payment Reference"),
    ];
    expect([...visitorContactIds(fields)]).toEqual(["player_name", "phone"]);
  });
});
