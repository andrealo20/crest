import { test } from "node:test";
import assert from "node:assert/strict";
import { findOtp, noticeCode } from "./otp.ts";

const found = (cases: [string, string][]) => {
  for (const [text, code] of cases) assert.equal(findOtp(text), code, text);
};
const none = (texts: string[]) => {
  for (const text of texts) assert.equal(findOtp(text), null, text);
};

test("English messages", () => {
  found([
    ["Your verification code is 482913", "482913"],
    ["482913 is your Microsoft account security code", "482913"],
    ["G-123456 is your Google verification code.", "123456"],
    ["Your Uber code is 1234", "1234"],
    ["Login code: 12345. Do not give this code to anyone.", "12345"],
    ["Your one-time passcode is 12345678", "12345678"],
    ["Use one time password 654321 to authorise the payment of EUR 50.00", "654321"],
    ["Your OTP is 654321", "654321"],
    ["Amazon: 123456 is your OTP. Don't share it", "123456"],
    ["Your PIN is 4821", "4821"],
    ["Use 482913 to verify your account", "482913"],
    ["Your Apple Account Code is: 482913.", "482913"],
    ["Enter 2FA code 305912 within 5 minutes", "305912"],
    ["Your code is 482913 2 minutes", "482913"],
    ["Code: 482913 Valid 10 min", "482913"],
  ]);
});

test("grouped digits give the plain code", () => {
  found([
    ["123-456 is your WhatsApp code", "123456"],
    ["Use 123 456 as your Acme code", "123456"],
    ["Your code is 1234-5678", "12345678"],
    ["Your code is 1234 5678", "12345678"],
    ["Your code is 123 456", "123456"],
    ["Your code is 123‑456", "123456"],
  ]);
});

test("the languages of Crest", () => {
  found([
    ["Il tuo codice di verifica è 482913", "482913"],
    ["Codice monouso: 91827364", "91827364"],
    ["Tu código de verificación es 482913", "482913"],
    ["Tu contraseña de un solo uso es 482913", "482913"],
    ["Votre code de vérification est 482913", "482913"],
    ["Votre code à usage unique : 4829", "4829"],
    ["Ihr Best\u00e4tigungscode lautet 482913", "482913"],
    ["Dein Code: 482913", "482913"],
    ["Dein Einmalpasswort 123456", "123456"],
    ["Seu código de verificação é 482913", "482913"],
    ["Sua senha de uso único é 123456", "123456"],
    ["Ваш код подтверждения: 482913", "482913"],
    ["Никому не сообщайте код 4829", "4829"],
    ["【某某】您的验证码是482913，5分钟内有效。", "482913"],
    ["您的验证码为：482913", "482913"],
    ["認証コードは482913です", "482913"],
    ["【銀行】ワンタイムパスワード：12345678", "12345678"],
    ["[Web발신] 인증번호 [482913]를 입력해 주세요", "482913"],
    ["رمز التحقق الخاص بك هو 482913", "482913"],
    ["आपका ओटीपी 482913 है", "482913"],
  ]);
});

test("digits of other scripts", () => {
  found([
    ["認証コード：４８２９１３", "482913"],
    ["رمز التحقق هو ٤٨٢٩١٣", "482913"],
    ["كود التأكيد ۱۲۳۴۵۶", "123456"],
    ["आपका सत्यापन कोड ४८२९१३", "482913"],
  ]);
});

test("text right to left around the digits", () => {
  found([
    ["‫رمز التحقق: 482913. لا تشاركه مع أحد.‬", "482913"],
    ["لا تشارك هذا الرمز مع أحد. رمز التحقق هو 482913", "482913"],
  ]);
  none(["وصل طلبك رقم 482913 اليوم"]);
});

test("the keyword may stand in the title and the digits in the text", () => {
  assert.equal(noticeCode({ title: "Acme verification code", body: "482913", exitCode: null }), "482913");
  assert.equal(noticeCode({ title: "Acme", body: "Your code is 482913" }), "482913");
  assert.equal(noticeCode({ title: "Acme", body: "Hello there" }), null);
});

test("a crest-notify run result is never searched", () => {
  assert.equal(noticeCode({ title: "code 482913", body: "code 482913", exitCode: 0 }), null);
  assert.equal(noticeCode({ title: "code 482913", body: "", exitCode: 1 }), null);
});

test("no keyword, no code", () => {
  none([
    "Your order 482913 has shipped",
    "Meeting at 14:30 in room 1234",
    "Lunch? Call me on 07700900123",
    "Invoice 12345678 is due",
    "482913",
    "",
    "Hello",
    "Your verification code is coming soon",
  ]);
});

test("the nearest number to the keyword wins, one code per notice", () => {
  found([
    ["Reach 998877 or use your code 5521", "5521"],
    ["Order 77421 shipped. Your code is 5521.", "5521"],
    ["Your verification code for order 12345678 is 482913", "482913"],
    ["Your PIN is 1234 and your code is 567890", "1234"],
    ["Code 482913. Do not share. Code 111222", "482913"],
  ]);
});

test("years, dates and times are not codes", () => {
  none([
    "Release code name 2025",
    "Verification code expires 2025-11-06",
    "Your code is valid until 06/11/2025",
    "Your code expires at 12:30",
    "Code review at 10:45:30",
    "The code freeze starts 12.11.2025",
  ]);
});

test("amounts, percentages and units are not codes", () => {
  none([
    "Code: charged $1234",
    "Verification: 5000 EUR charged",
    "Your code costs 1234€",
    "Verification progress 5000%",
    "Code 99,99 EUR",
    "Passcode 1234.56",
    "Your code is worth 1,234,567 points",
    "Verification code for 5000 USD",
    "验证码 2000元",
  ]);
});

test("phone numbers, order numbers and tracking numbers are not codes", () => {
  none([
    "Verification call from +44 7700 900123",
    "Call code 555-1234",
    "Your code: 555-123-4567",
    "Your code is 123456789012",
    "Tracking code 1Z999AA10123456784",
    "Your order number 12345678 (code received)",
    "Booking code, ref 87654321",
    "Phone 1234 5678, ask for the code",
    "Code AB123456",
    "Code 123456abc",
    "Code review: PR #12345",
    "Code for ticket no. 482913",
  ]);
});

test("codes of another kind are not one-time codes", () => {
  none([
    "Postal code 75001",
    "Zip code 90210",
    "Promo code 482913",
    "Discount code 123456 at checkout",
    "Error code 40401",
    "Exit code 12345",
    "Gutschein-Code 123456",
    "Code postal 75001",
    "Código postal 28001",
    "Codice fiscale 12345678",
    "Código de descuento 482913",
  ]);
});

test("the digits must be 4 to 8, in one group or two equal ones", () => {
  none([
    "Your code is 123",
    "Your code is 12 34 56",
    "Your code is 12-34-56",
    "Your code is 1234 567",
    "Your code is 1234 5678 9012",
  ]);
  assert.equal(findOtp("Your code is 12345678"), "12345678");
  assert.equal(findOtp("Your code is 1234"), "1234");
});

test("the keyword must be close to the digits", () => {
  const far = "Your code" + " and a lot of other words in between".repeat(3) + " 482913";
  assert.equal(findOtp(far), null);
  assert.equal(findOtp("Your code is " + "x".repeat(20) + " 482913"), "482913");
});

test("very long text neither breaks nor slows", () => {
  const long = "word ".repeat(200000);
  assert.equal(findOtp(long + " your code is 482913"), null);
  assert.equal(findOtp("your code is 482913 " + long), "482913");
  assert.equal(findOtp("1".repeat(100000) + " code"), null);
  assert.equal(findOtp("code " + "1 ".repeat(100000)), null);
  assert.equal(findOtp("verif".repeat(50000)), null);
});

test("line breaks and tabs between keyword and digits", () => {
  found([
    ["Your code is\n482913", "482913"],
    ["Verification code\t482913", "482913"],
  ]);
});
