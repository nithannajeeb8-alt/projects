#ifndef POCKETWISE_FINANCIAL_ENGINE_H
#define POCKETWISE_FINANCIAL_ENGINE_H

#ifdef __cplusplus
extern "C" {
#endif

typedef struct PWTransactionInput {
  long long amount_minor;
  int type_code;
  int cash_flow_bucket;
} PWTransactionInput;

typedef struct PWFinancialResult {
  long long values[23];
  unsigned int transaction_count;
  unsigned int status;
} PWFinancialResult;

typedef struct PWBalanceInput {
  long long amount_minor;
  int type_code;
  unsigned int flags; /* bit 0: from/account match; bit 1: transfer destination match */
} PWBalanceInput;

typedef struct PWSalaryInput {
  long long value_scaled; /* fixed: paise; percentage: percent * 100 */
  int mode_code;          /* 0: fixed, 1: percentage */
  int reserved;
} PWSalaryInput;

typedef struct PWSalaryOutput {
  long long period_minor;
  long long per_cycle_minor;
} PWSalaryOutput;

typedef struct PWCategoryBucketInput {
  long long amount_minor;
  unsigned int group_index;
  unsigned int bucket_index;
  unsigned int period_index; /* 0: current, 1: previous */
  int sign;                  /* +1: expense, -1: refund */
} PWCategoryBucketInput;

unsigned int pw_alloc(unsigned int size);
void pw_reset(void);
int pw_aggregate(const PWTransactionInput *transactions,
                 unsigned int count,
                 PWFinancialResult *result);

/* Integer-paise allocation and balance kernels. Return zero on success. */
int pw_equal_split(long long total_minor, unsigned int count, long long *output);
int pw_percentage_split(long long total_minor, const int *basis_points,
                        unsigned int count, long long *output);
int pw_amount_split(long long total_minor, const long long *amounts,
                    unsigned int count, long long *output);
int pw_sum_minor(const long long *values, unsigned int count, long long *output);
int pw_cash_delta_minor(long long amount_minor, int type_code, long long *output);
int pw_account_balance(long long opening_minor, const PWBalanceInput *rows,
                       unsigned int count, long long *output);
int pw_debt_remaining(long long original_minor, const long long *repayments,
                      unsigned int count, long long *output);
int pw_salary_allocate(long long base_minor, long long per_cycle_base_minor,
                       unsigned int pay_cycles, unsigned int per_cycle_percent_denominator,
                       const PWSalaryInput *rules,
                       unsigned int count, PWSalaryOutput *outputs,
                       long long *summary); /* allocated, fixed, percentage * 100 */
int pw_category_buckets(const PWCategoryBucketInput *rows, unsigned int count,
                        unsigned int group_count, unsigned int bucket_count,
                        long long *output);
int pw_cash_projection(long long opening_minor, const long long *deltas,
                       unsigned int count, long long *output); /* ending, minimum, first shortage, index */
int pw_ratio_round_minor(long long amount_minor, unsigned int numerator,
                         unsigned int denominator, long long *output);

#ifdef __cplusplus
}
#endif
#endif
