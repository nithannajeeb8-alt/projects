#include "financial_engine.h"

/*
 * PocketWise Alpha 1 financial kernel.
 * No DOM, storage, locale, filesystem, or network dependencies.
 * All monetary values cross the boundary as integer paise.
 */

extern "C" unsigned char __heap_base;

namespace {
static unsigned int heap_cursor = 0;
static const unsigned int MAX_ROWS = 1000000U;
static const int TYPE_INCOME = 1;
static const int TYPE_EXPENSE = 2;
static const int TYPE_REFUND = 3;
static const int TYPE_BORROWED = 4;
static const int TYPE_LENT = 5;
static const int TYPE_REPAY_IN = 6;
static const int TYPE_REPAY_OUT = 7;
static const int TYPE_TRANSFER = 8;

/* Cash-flow buckets: 1 salary, 2 other income, 3 everyday, 4 bills,
 * 5 shopping, 6 subscriptions. */
bool addChecked(long long &target, long long value) {
  long long result = 0;
#if defined(__has_builtin)
#if __has_builtin(__builtin_add_overflow)
  if (__builtin_add_overflow(target, value, &result)) return false;
  target = result;
  return true;
#endif
#endif
  if ((value > 0 && target > 9223372036854775807LL - value) ||
      (value < 0 && target < (-9223372036854775807LL - 1LL) - value)) return false;
  target += value;
  return true;
}

bool addTo(PWFinancialResult *out, unsigned int index, long long value) {
  return addChecked(out->values[index], value);
}
}

extern "C" unsigned int pw_alloc(unsigned int size) {
  if (size == 0U) size = 1U;
  if (heap_cursor == 0U) {
    const unsigned int base = (unsigned int)(unsigned long)&__heap_base;
    heap_cursor = (base + 7U) & ~7U;
  }
  const unsigned int aligned = (size + 7U) & ~7U;
  if (aligned < size || heap_cursor > 0xFFFFFFFFU - aligned) return 0U;
  const unsigned int result = heap_cursor;
  heap_cursor += aligned;
  return result;
}

extern "C" void pw_reset(void) {
  heap_cursor = 0U;
}

extern "C" int pw_aggregate(const PWTransactionInput *transactions,
                              unsigned int count,
                              PWFinancialResult *result) {
  if (!result || (count > 0U && !transactions) || count > MAX_ROWS) return 1;
  for (unsigned int i = 0; i < 23U; ++i) result->values[i] = 0LL;
  result->transaction_count = count;
  result->status = 0U;

  for (unsigned int i = 0; i < count; ++i) {
    const PWTransactionInput &tx = transactions[i];
    const long long amount = tx.amount_minor;
    bool ok = true;

    switch (tx.type_code) {
      case TYPE_INCOME:
        ok = addTo(result, 0U, amount) && addTo(result, 7U, amount) && addTo(result, 8U, amount);
        if (tx.cash_flow_bucket == 1) ok = ok && addTo(result, 9U, amount);
        else ok = ok && addTo(result, 10U, amount);
        break;
      case TYPE_EXPENSE:
        ok = addTo(result, 1U, amount) && addTo(result, 7U, -amount) && addTo(result, 8U, -amount);
        if (tx.cash_flow_bucket == 4) ok = ok && addTo(result, 16U, amount);
        else if (tx.cash_flow_bucket == 5) ok = ok && addTo(result, 17U, amount);
        else if (tx.cash_flow_bucket == 6) ok = ok && addTo(result, 18U, amount);
        else ok = ok && addTo(result, 15U, amount);
        break;
      case TYPE_REFUND:
        ok = addTo(result, 2U, amount) && addTo(result, 7U, amount) && addTo(result, 8U, amount) && addTo(result, 11U, amount);
        break;
      case TYPE_BORROWED:
        ok = addTo(result, 3U, amount) && addTo(result, 8U, amount) && addTo(result, 13U, amount);
        break;
      case TYPE_LENT:
        ok = addTo(result, 4U, amount) && addTo(result, 8U, -amount) && addTo(result, 20U, amount);
        break;
      case TYPE_REPAY_IN:
        ok = addTo(result, 5U, amount) && addTo(result, 8U, amount) && addTo(result, 12U, amount);
        break;
      case TYPE_REPAY_OUT:
        ok = addTo(result, 6U, amount) && addTo(result, 8U, -amount) && addTo(result, 19U, amount);
        break;
      case TYPE_TRANSFER:
        ok = addTo(result, 22U, amount);
        break;
      default:
        /* Unknown transaction types remain counted, matching the JS API. */
        break;
    }

    if (!ok) {
      result->status = 2U;
      return 2;
    }
  }

  /* The outflow/inflow buckets are deliberately raw positive transaction
   * amounts, just like the pre-existing JavaScript cash-flow implementation. */
  return 0;
}

/* Freestanding byte helper required by some optimizing compiler builds. */
extern "C" void *memset(void *destination, int value, unsigned long size) {
  unsigned char *bytes = (unsigned char *)destination;
  for (unsigned long i = 0; i < size; ++i) bytes[i] = (unsigned char)value;
  return destination;
}
