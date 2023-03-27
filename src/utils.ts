const Base2N = require("@navpreetdevpuri/base-2-n");

async function getDocument(model, fieldName, sortFieldName, skip) {
  return model
    .findOne({ [sortFieldName]: { $ne: null } }, { [fieldName]: 1, [sortFieldName]: 1 })
    .sort({ [sortFieldName]: 1 })
    .skip(skip)
    .exec();
}

async function generateSortIdUsingBinarySearch(model, fieldName, fieldValue, sortFieldName) {
  const { ignoreCases, noOfCharsForSortId, noOfCharsToIncreaseOnSaturation } = model.schema.options.sortEncryptedFieldsOptions;
  fieldValue = fieldValue || "";
  fieldValue = ignoreCases ? fieldValue.toLowerCase() : fieldValue;
  const n = await model
    .findOne({ [sortFieldName]: { $ne: null } })
    .count()
    .exec();
  if (n === 0) {
    const predecessorSortId = new Base2N("\0", 16, noOfCharsForSortId).toString();
    const successorSortId = "".padEnd(noOfCharsForSortId, "\uffff");
    return getAverageSortId(predecessorSortId, successorSortId, noOfCharsToIncreaseOnSaturation);
  }
  let start = 0;
  let end = n - 1;
  let startDoc = await getDocument(model, fieldName, sortFieldName, start);
  let midDoc;
  let endDoc = await getDocument(model, fieldName, sortFieldName, end);
  let startValue;
  let midValue;
  let endValue;

  while (start <= end) {
    const mid = Math.floor((start + end) / 2);
    midDoc = await getDocument(model, fieldName, sortFieldName, mid);

    startValue = startDoc[fieldName] || "";
    midValue = midDoc[fieldName] || "";
    endValue = endDoc[fieldName] || "";
    startValue = ignoreCases ? startValue.toLowerCase() : startValue;
    midValue = ignoreCases ? midValue.toLowerCase() : midValue;
    endValue = ignoreCases ? endValue.toLowerCase() : endValue;
    if (fieldValue === midValue) {
      return midDoc[sortFieldName];
    } else if (fieldValue < midValue) {
      end = mid - 1;
      if (end < 0) {
        break;
      }
      endDoc = await getDocument(model, fieldName, sortFieldName, end);
    } else if (midValue < fieldValue) {
      start = mid + 1;
      if (start === n) {
        break;
      }
      startDoc = await getDocument(model, fieldName, sortFieldName, start);
    }
  }

  if (start === 0) {
    return getAverageSortId(null, startDoc[sortFieldName], noOfCharsToIncreaseOnSaturation);
  }

  if (start === n) {
    startDoc = await getDocument(model, fieldName, sortFieldName, start - 1);
    return getAverageSortId(startDoc[sortFieldName], null, noOfCharsToIncreaseOnSaturation);
  }

  endDoc = await getDocument(model, fieldName, sortFieldName, start - 1);
  return getAverageSortId(endDoc[sortFieldName], startDoc[sortFieldName], noOfCharsToIncreaseOnSaturation);
}

function getAverageSortId(predecessorSortId, successorSortId, noOfCharsToIncreaseOnSaturation) {
  if (!predecessorSortId) {
    predecessorSortId = "".padEnd(successorSortId.length, "\0");
  }

  if (!successorSortId) {
    successorSortId = "".padEnd(predecessorSortId.length, "\uffff");
  }

  let predecessorNumber;
  let successorNumber;

  if (predecessorSortId.length === successorSortId.length) {
    predecessorNumber = new Base2N(predecessorSortId, 16);
    successorNumber = new Base2N(successorSortId, 16);
    const averageNumber = predecessorNumber.average(successorNumber);
    if (averageNumber.toString() !== predecessorNumber.toString()) {
      return averageNumber.toString();
    }
    predecessorNumber = new Base2N(predecessorSortId.padEnd(averageNumber.length + noOfCharsToIncreaseOnSaturation, "\0"), 16);
    successorNumber = new Base2N(successorSortId.padEnd(averageNumber.length + noOfCharsToIncreaseOnSaturation, "\0"), 16);
    return predecessorNumber.average(successorNumber).toString();
  }

  const bigger = predecessorSortId.length > successorSortId.length ? predecessorSortId : successorSortId;
  const smaller = successorSortId.length > predecessorSortId.length ? predecessorSortId : successorSortId;

  const biggerNumber = new Base2N(bigger, 16);
  const smallerNumber = new Base2N(smaller.padEnd(bigger.length, "\0"), 16);

  return biggerNumber.average(smallerNumber).toString();
}

async function updateSortFieldsForDocument({ objectId, model, fieldName, fieldValue, sortFieldName }) {
  const { silent, noOfCharsToIncreaseOnSaturation } = model.schema.options.sortEncryptedFieldsOptions;
  if (!silent) {
    console.time(
      `mongoose-sort-encrypted-field -> updateSortFieldsForDocument() -> objectId: ${objectId}, fieldName: ${fieldName}, sortFieldName: ${sortFieldName}, timeTaken: `
    );
  }
  const newSortId = await generateSortIdUsingBinarySearch(model, fieldName, fieldValue, sortFieldName);
  await model.updateOne({ _id: objectId }, { $set: { [sortFieldName]: newSortId.toString() } });
  if (!silent) {
    console.timeEnd(
      `mongoose-sort-encrypted-field -> updateSortFieldsForDocument() -> objectId: ${objectId}, fieldName: ${fieldName}, sortFieldName: ${sortFieldName}, timeTaken: `
    );
  }
}

async function generateSortIdForAllDocuments({ model, fieldName, sortFieldName }) {
  const { silent, ignoreCases, noOfCharsForSortId } = model.schema.options.sortEncryptedFieldsOptions;
  if (!silent) {
    console.time(
      `mongoose-sort-encrypted-field -> generateSortIdForAllDocuments() -> fieldName: ${fieldName}, sortFieldName: ${sortFieldName}, sortFieldName: ${sortFieldName}, timeTaken: `
    );
  }
  const documents = await model.find({}, { [fieldName]: 1 }).exec();
  documents.sort((a, b) => {
    let aValue = a[fieldName] || "";
    let bValue = b[fieldName] || "";
    aValue = ignoreCases ? aValue.toLowerCase() : aValue;
    bValue = ignoreCases ? bValue.toLowerCase() : bValue;
    return aValue.localeCompare(bValue);
  });
  const n = documents.length;
  const log2n = Math.round(Math.log2(n)) + 1;
  let diff = new Base2N("".padEnd(noOfCharsForSortId, "\uffff"), 16);
  for (let i = 0; i < log2n; i += 1) {
    diff = diff.half();
  }
  let curr = new Base2N("\0", 16, noOfCharsForSortId);
  for (let i = 0; i < n; i += 1) {
    if (i === 0 || documents[i - 1][fieldName] !== documents[i][fieldName]) {
      curr = curr.add(diff);
    }
    await model.updateOne({ _id: documents[i]._id }, { $set: { [sortFieldName]: curr.toString() } });
  }
  if (!silent) {
    console.timeEnd(
      `mongoose-sort-encrypted-field -> generateSortIdForAllDocuments() -> fieldName: ${fieldName}, sortFieldName: ${sortFieldName}, timeTaken: `
    );
  }
}

export { updateSortFieldsForDocument, generateSortIdForAllDocuments };
