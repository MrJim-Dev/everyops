import { describe, expect, it } from "vitest";
import { isDisposableEmail } from "./disposable";

describe("isDisposableEmail", () => {
  it("refuses throwaway inboxes and their subdomains, in any case", () => {
    expect(isDisposableEmail("someone@mailinator.com")).toBe(true);
    expect(isDisposableEmail("Someone@YOPMAIL.com")).toBe(true);
    expect(isDisposableEmail("x@inbox.guerrillamail.com")).toBe(true);
  });

  it("lets real providers and company domains through", () => {
    expect(isDisposableEmail("owner@gmail.com")).toBe(false);
    expect(isDisposableEmail("james@everyops.app")).toBe(false);
    expect(isDisposableEmail("notmailinator.com@gmail.com")).toBe(false);
    expect(isDisposableEmail("broken")).toBe(false);
  });
});
