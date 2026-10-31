/* PocketWise shared-cost calculation engine.
   All monetary allocations are performed in integer paise. No records are written here. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PocketwiseSharedCosts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_MINOR = Number.MAX_SAFE_INTEGER;

  function toMinorUnits(value) {
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value < 0 || value > MAX_MINOR / 100) return NaN;
      return Math.round((value + Number.EPSILON) * 100);
    }
    const source = String(value ?? '').trim().replace(/^(?:₹|INR\s*|Rs\.?\s*)/i, '').trim();
    const grouped = /^(?:\d{1,2}(?:,\d{2})*,\d{3}|\d{1,3}(?:,\d{3})+)$/;
    if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(source.replace(/,/g, '')) || (source.includes(',') && !grouped.test(source.split('.')[0]))) return NaN;
    const raw = source.replace(/,/g, '');
    const [whole = '0', fraction = ''] = raw.split('.');
    const minor = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
    return Number.isSafeInteger(minor) ? minor : NaN;
  }

  function fromMinorUnits(value) {
    if (!Number.isSafeInteger(value)) throw new RangeError('Money must be a safe integer number of paise.');
    return value / 100;
  }

  function assertMinor(totalMinor) {
    if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) throw new RangeError('Enter a valid non-negative amount.');
  }

  function equalSplit(totalMinor, count) {
    assertMinor(totalMinor);
    if (!Number.isInteger(count) || count < 1 || count > 200) throw new RangeError('A split must contain between 1 and 200 people or groups.');
    const base = Math.floor(totalMinor / count);
    const remainder = totalMinor - base * count;
    return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
  }

  function percentageToBasisPoints(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > 100) throw new RangeError('Percentages must be between 0 and 100.');
    const basis = Math.round(number * 100);
    if (Math.abs(number * 100 - basis) > 1e-7) throw new RangeError('Use percentages with no more than two decimal places.');
    return basis;
  }

  /* Hamilton/largest-remainder apportionment: rounded shares always sum to the exact total. */
  function percentageSplit(totalMinor, percentages) {
    assertMinor(totalMinor);
    if (!Array.isArray(percentages) || percentages.length < 1 || percentages.length > 200) throw new RangeError('Add at least one recipient before splitting.');
    const basisPoints = percentages.map(percentageToBasisPoints);
    if (basisPoints.reduce((sum, value) => sum + value, 0) !== 10000) throw new RangeError('Percentages must add up to exactly 100%.');
    const total = BigInt(totalMinor);
    const quotas = basisPoints.map((basis, index) => {
      const numerator = total * BigInt(basis);
      const floor = numerator / 10000n;
      return { index, floor, remainder: numerator % 10000n };
    });
    const allocated = quotas.map(item => Number(item.floor));
    const floorTotal = quotas.reduce((sum, item) => sum + item.floor, 0n);
    const remaining = Number(total - floorTotal);
    const order = quotas.slice().sort((a, b) => a.remainder === b.remainder ? a.index - b.index : (a.remainder > b.remainder ? -1 : 1));
    for (let i = 0; i < remaining; i++) allocated[order[i].index] += 1;
    return allocated;
  }

  function amountSplit(totalMinor, amounts) {
    assertMinor(totalMinor);
    if (!Array.isArray(amounts) || amounts.length < 1 || amounts.length > 200) throw new RangeError('Add at least one recipient before splitting.');
    const parsed = amounts.map(value => typeof value === 'number' && Number.isSafeInteger(value) ? value : toMinorUnits(value));
    if (parsed.some(value => !Number.isSafeInteger(value) || value < 0)) throw new RangeError('Each share must be a valid non-negative amount.');
    if (!Number.isSafeInteger(parsed.reduce((sum, value) => sum + value, 0)) || parsed.reduce((sum, value) => sum + value, 0) !== totalMinor) throw new RangeError('The entered shares must add up to the full amount.');
    return parsed;
  }

  function allocate(totalMinor, mode, values, count) {
    if (mode === 'equal') return equalSplit(totalMinor, count);
    if (mode === 'percent') return percentageSplit(totalMinor, values);
    if (mode === 'amount') return amountSplit(totalMinor, values);
    throw new RangeError('Choose equal, percentage or exact-amount allocation.');
  }

  function calculateBill(totalMinor, participants) {
    assertMinor(totalMinor);
    if (!Array.isArray(participants) || participants.length < 2 || participants.length > 100) throw new RangeError('A bill split needs between 2 and 100 people.');
    const ids = participants.map(person => String(person?.id ?? '').trim());
    if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new RangeError('Each person needs a unique participant identifier.');
    if (participants.some(person => !String(person?.name ?? '').trim())) throw new RangeError('Give every person a name before splitting the bill.');
    const shares = equalSplit(totalMinor, participants.length);
    return {
      totalMinor,
      shares: participants.map((person, index) => ({ id: ids[index], name: String(person.name).trim(), amountMinor: shares[index] })),
      allocatedMinor: shares.reduce((sum, value) => sum + value, 0),
      remainingMinor: 0
    };
  }

  function calculateEvent(plan) {
    if (!plan || typeof plan !== 'object') throw new TypeError('Event plan is missing.');
    const totalMinor = Number(plan.totalMinor);
    assertMinor(totalMinor);
    const splitMode = plan.splitMode === 'groups' ? 'groups' : 'individual';
    const people = Array.isArray(plan.participants) ? plan.participants : [];
    const groups = Array.isArray(plan.groups) ? plan.groups : [];
    const categories = Array.isArray(plan.categories) ? plan.categories : [];
    if (!people.length || people.length > 100) throw new RangeError('An event needs between 1 and 100 named participants.');
    if (!categories.length || categories.length > 30) throw new RangeError('An event needs between 1 and 30 cost categories.');
    const peopleIds = people.map(person => String(person?.id ?? '').trim());
    if (peopleIds.some(id => !id) || new Set(peopleIds).size !== people.length) throw new RangeError('Participant identifiers must be unique and non-empty.');
    if (people.some(person => !String(person?.name ?? '').trim())) throw new RangeError('Give every participant a name.');
    const peopleById = new Map(people.map((person, index) => [peopleIds[index], person]));

    let units;
    if (splitMode === 'groups') {
      if (!groups.length || groups.length > 25) throw new RangeError('A group event needs between 1 and 25 groups.');
      const groupIds = groups.map(group => String(group?.id ?? '').trim());
      if (groupIds.some(id => !id) || new Set(groupIds).size !== groups.length) throw new RangeError('Each group needs a unique identifier.');
      if (groups.some(group => !String(group?.name ?? '').trim())) throw new RangeError('Give every group a name.');
      const seenMembers = new Set();
      groups.forEach(group => {
        const members = Array.isArray(group.memberIds) ? group.memberIds.map(String) : [];
        if (!members.length) throw new RangeError(`Add at least one person to ${String(group.name || 'each group')}.`);
        members.forEach(id => {
          if (!peopleById.has(id) || seenMembers.has(id)) throw new RangeError('Each participant must belong to exactly one group.');
          seenMembers.add(id);
        });
      });
      if (seenMembers.size !== people.length) throw new RangeError('Every participant must belong to a group.');
      units = groups.map((group, index) => ({ id: groupIds[index], name: String(group.name).trim(), memberIds: group.memberIds.map(String) }));
    } else {
      units = people.map((person, index) => ({ id: peopleIds[index], name: String(person.name).trim(), memberIds: [peopleIds[index]] }));
    }

    const categoryIds = categories.map(category => String(category?.id ?? '').trim());
    if (categoryIds.some(id => !id) || new Set(categoryIds).size !== categories.length) throw new RangeError('Each cost category needs a unique identifier.');
    if (categories.some(category => !String(category?.name ?? '').trim())) throw new RangeError('Give every cost category a name.');

    const categoryTotal = categories.reduce((sum, category) => {
      const amount = Number(category.amountMinor);
      if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError(`Enter a valid amount for ${String(category.name || 'each category')}.`);
      return sum + amount;
    }, 0);
    if (!Number.isSafeInteger(categoryTotal) || categoryTotal !== totalMinor) throw new RangeError('Category amounts must add up exactly to the event total.');

    const participantTotals = new Map(people.map(person => [String(person.id), 0]));
    const groupTotals = new Map(units.map(unit => [unit.id, 0]));
    const categoryResults = [];

    categories.forEach(category => {
      const amountMinor = Number(category.amountMinor);
      const mode = category.mode || 'equal';
      const categoryShares = Array.isArray(category.shares) ? category.shares : [];
      let shareValues = [];
      if (mode !== 'equal') {
        const shareIds = categoryShares.map(share => String(share?.unitId ?? '').trim());
        const expectedIds = units.map(unit => unit.id);
        if (shareIds.length !== expectedIds.length || shareIds.some(id => !id) || new Set(shareIds).size !== shareIds.length || expectedIds.some(id => !shareIds.includes(id))) {
          throw new RangeError(`Every ${splitMode === 'groups' ? 'group' : 'participant'} needs exactly one share in ${String(category.name || 'this category')}.`);
        }
        const shareById = new Map(categoryShares.map(share => [String(share.unitId), share]));
        shareValues = units.map(unit => Number(shareById.get(unit.id)?.value));
      }
      const unitShares = allocate(amountMinor, mode, mode === 'equal' ? [] : shareValues, units.length);
      const byUnit = [];
      units.forEach((unit, index) => {
        const unitAmount = unitShares[index];
        groupTotals.set(unit.id, groupTotals.get(unit.id) + unitAmount);
        const memberShares = equalSplit(unitAmount, unit.memberIds.length);
        unit.memberIds.forEach((personId, personIndex) => participantTotals.set(personId, participantTotals.get(personId) + memberShares[personIndex]));
        byUnit.push({
          unitId: unit.id,
          unitName: unit.name,
          amountMinor: unitAmount,
          members: unit.memberIds.map((personId, personIndex) => ({
            id: personId,
            name: String(peopleById.get(personId)?.name || '').trim(),
            amountMinor: memberShares[personIndex]
          }))
        });
      });
      categoryResults.push({ id: String(category.id), name: String(category.name || '').trim(), amountMinor, mode, allocations: byUnit });
    });

    const peopleResult = people.map(person => ({ id: String(person.id), name: String(person.name || '').trim(), amountMinor: participantTotals.get(String(person.id)) || 0 }));
    const allocatedMinor = peopleResult.reduce((sum, person) => sum + person.amountMinor, 0);
    if (allocatedMinor !== totalMinor) throw new Error('The event allocation does not reconcile to the total cost.');
    return {
      totalMinor,
      categoryTotalMinor: categoryTotal,
      allocatedMinor,
      remainingMinor: totalMinor - allocatedMinor,
      people: peopleResult,
      groups: units.map(unit => ({ id: unit.id, name: unit.name, amountMinor: groupTotals.get(unit.id) || 0, members: unit.memberIds.map(id => peopleResult.find(person => person.id === id)).filter(Boolean) })),
      categories: categoryResults
    };
  }

  return { toMinorUnits, fromMinorUnits, equalSplit, percentageSplit, amountSplit, allocate, calculateBill, calculateEvent };
});
