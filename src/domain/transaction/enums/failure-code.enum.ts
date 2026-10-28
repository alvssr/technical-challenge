export enum FailureCode {
  InsufficientFunds = 'INSUFFICIENT_FUNDS',
  MissingReference = 'MISSING_REFERENCE',
  InvalidReferenceState = 'INVALID_REFERENCE_STATE',
  DuplicateTransaction = 'DUPLICATE_TRANSACTION',
  CurrencyMismatch = 'CURRENCY_MISMATCH',
  InvalidOperationKind = 'INVALID_OPERATION_KIND',
  PayloadMismatch = 'PAYLOAD_MISMATCH',
  ReversalWouldCauseNegativeBalance = 'REVERSAL_WOULD_CAUSE_NEGATIVE_BALANCE',
}
