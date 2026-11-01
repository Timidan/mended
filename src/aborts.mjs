// Abort codes from Walrus's contract docs. The chain only returns the number.
export const MEMWAL_ABORTS = {
  0: ['EDelegateKeyAlreadyExists', 'This key is already registered on the account.'],
  1: ['EDelegateKeyNotFound', 'That key was not on the account when you tried to remove it.'],
  2: ['ETooManyDelegateKeys', 'The account has reached its limit of 20 delegate keys.'],
  3: ['EAccountAlreadyExists', 'This address already has an account, and each address can only have one.'],
  4: ['ENotOwner', "The caller isn't the account's owner."],
  5: ['EInvalidPublicKeyLength', "The public key isn't exactly 32 bytes."],
  6: ['EAccountDeactivated', 'The account is frozen, so the operation was denied.'],
  7: ['EWrongVersion', "The registry's version doesn't match this package."],
  20: ['EAccountQuarantined', 'An admin quarantine is blocking the owner from reactivating the account.'],
}
