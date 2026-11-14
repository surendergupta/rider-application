import { describe, expect, it } from "vitest";
import { describeStatus, documentStatus, todayInIndia } from "@/features/garage/documents";

describe("document expiry", () => {
  it("is valid on the expiry date itself, expired from the next day", () => {
    expect(documentStatus("2026-12-01", "2026-12-01")).toEqual({ state: "expiring", daysLeft: 0 });
    expect(documentStatus("2026-12-01", "2026-12-02")).toEqual({ state: "expired", daysLeft: -1 });
  });
  it("flags documents expiring within 30 days, not beyond", () => {
    expect(documentStatus("2026-12-31", "2026-12-01").state).toBe("expiring"); // 30 days
    expect(documentStatus("2027-01-01", "2026-12-01").state).toBe("ok");       // 31 days
  });
  it("counts days correctly across month and year ends and leap years", () => {
    expect(documentStatus("2027-01-05", "2026-12-30").daysLeft).toBe(6);
    expect(documentStatus("2028-03-01", "2028-02-28").daysLeft).toBe(2); // 2028 is a leap year
  });
  it("describes status in plain words", () => {
    expect(describeStatus({ state: "expired", daysLeft: -3 })).toBe("Expired 3 days ago");
    expect(describeStatus({ state: "expired", daysLeft: -1 })).toBe("Expired 1 day ago");
    expect(describeStatus({ state: "expiring", daysLeft: 0 })).toBe("Expires today");
    expect(describeStatus({ state: "expiring", daysLeft: 1 })).toBe("Expires in 1 day");
    expect(describeStatus({ state: "ok", daysLeft: 90 })).toBe("Expires in 90 days");
  });
  it("uses the Indian calendar date, which can differ from UTC", () => {
    // 20:00 UTC on 31 Dec is already 1:30 am on 1 Jan in India
    expect(todayInIndia(new Date("2026-12-31T20:00:00Z"))).toBe("2027-01-01");
    expect(todayInIndia(new Date("2026-12-31T10:00:00Z"))).toBe("2026-12-31");
  });
});
