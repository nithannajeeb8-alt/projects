#ifndef POCKETWISE_FINANCIAL_ENGINE_H
#define POCKETWISE_FINANCIAL_ENGINE_H

#ifdef __cplusplus
extern "C" {
#endif

/* Input row: integer paise, transaction type code, and cash-flow category code. */
typedef struct PWTransactionInput {
  long long amount_minor;
  int type_code;
  int cash_flow_bucket;
} PWTransactionInput;

/* 23 signed paise totals followed by transaction count and status. */
typedef struct PWFinancialResult {
  long long values[23];
  unsigned int transaction_count;
  unsigned int status;
} PWFinancialResult;

unsigned int pw_alloc(unsigned int size);
void pw_reset(void);
int pw_aggregate(const PWTransactionInput *transactions,
                 unsigned int count,
                 PWFinancialResult *result);

#ifdef __cplusplus
}
#endif
#endif
