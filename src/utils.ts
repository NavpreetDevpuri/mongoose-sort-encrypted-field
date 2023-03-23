async function documentsBinarySearch(model, fieldName, fieldValue, sortFieldName, ignoreCases) {
  const n = await model
    .findOne({ [sortFieldName]: { $ne: null } })
    .count()
    .exec();
  if (n === 0) {
    return {
      predecessorSortId: null,
      successorSortId: new Base2N("\0").toString(),
    };
  }
  let start = 0;
  let end = n - 1;
  let startDoc = await model
    .findOne({ [sortFieldName]: { $ne: null } }, { [fieldName]: 1, [sortFieldName]: 1 })
    .sort({ [sortFieldName]: 1 })
    .skip(start)
    .exec();
  let midDoc;
  let endDoc = await model
    .findOne({ [sortFieldName]: { $ne: null } }, { [fieldName]: 1, [sortFieldName]: 1 })
    .sort({ [sortFieldName]: 1 })
    .skip(end)
    .exec();
  let startValue;
  let midValue;
  let endValue;
  fieldValue = ignoreCases ? fieldValue.toLowerCase() : fieldValue;

  while (start <= end) {
    const mid = Math.ceil((start + end) / 2);
    midDoc = await model
      .findOne({ [sortFieldName]: { $ne: null } }, { [fieldName]: 1, [sortFieldName]: 1 })
      .sort({ [sortFieldName]: 1 })
      .skip(mid)
      .exec();

    startValue = String(startDoc[fieldName]);
    midValue = String(midDoc[fieldName]);
    endValue = String(endDoc[fieldName]);
    startValue = ignoreCases ? startValue.toLowerCase() : startValue;
    midValue = ignoreCases ? midValue.toLowerCase() : midValue;
    endValue = ignoreCases ? endValue.toLowerCase() : endValue;

    if (fieldValue < midValue) {
      end = mid - 1;
      if (end <= 0) {
        break;
      }
      endDoc = await model
        .findOne({ [sortFieldName]: { $ne: null } }, { [fieldName]: 1, [sortFieldName]: 1 })
        .sort({ [sortFieldName]: 1 })
        .skip(end)
        .exec();
    } else if (midValue <= fieldValue) {
      start = mid + 1;
      if (start === n) {
        break;
      }
      startDoc = await model
        .findOne({ [sortFieldName]: { $ne: null } }, { [fieldName]: 1, [sortFieldName]: 1 })
        .sort({ [sortFieldName]: 1 })
        .skip(start)
        .exec();
    }
  }

  if (start === 0) {
    return {
      predecessorSortId: null,
      successorSortId: startDoc[sortFieldName],
    };
  }

  if (start === n) {
    startDoc = await model
      .findOne({ [sortFieldName]: { $ne: null } }, { [sortFieldName]: 1 })
      .sort({ [sortFieldName]: 1 })
      .skip(start - 1)
      .exec();
    return {
      predecessorSortId: startDoc[sortFieldName],
      successorSortId: null,
    };
  }

  if (start === end) {
    endDoc = await model
      .findOne({ [sortFieldName]: { $ne: null } }, { [fieldName]: 1, [sortFieldName]: 1 })
      .sort({ [sortFieldName]: 1 })
      .skip(start - 1)
      .exec();
  }

  let predecessorDoc = endDoc;
  const successorDoc = startDoc;

  return {
    predecessorSortId: predecessorDoc[sortFieldName],
    successorSortId: successorDoc[sortFieldName],
  };
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

  if (predecessorSortId.length == predecessorSortId.length) {
    predecessorNumber = new Base2N(predecessorSortId);
    successorNumber = new Base2N(successorSortId);
    const averageNumber = predecessorNumber.average(successorNumber);
    if (averageNumber.toString() != predecessorNumber.toString()) {
      return averageNumber.toString();
    }
    predecessorNumber = new Base2N(predecessorSortId.padEnd(averageNumber.length + noOfCharsToIncreaseOnSaturation, "\0"));
    successorNumber = new Base2N(successorSortId.padEnd(averageNumber.length + noOfCharsToIncreaseOnSaturation, "\0"));
    return predecessorNumber.average(successorNumber).toString();
  }

  const bigger = predecessorSortId.length > successorSortId.length ? predecessorSortId : successorSortId;
  const smaller = successorSortId.length > predecessorSortId.length ? predecessorSortId : successorSortId;

  const biggerNumber = new Base2N(bigger);
  const smallerNumber = new Base2N(smaller.padEnd(bigger.length, "\0"));

  return biggerNumber.average(smallerNumber).toString();
}

async function updateSortFieldsForDocument({
  objectId,
  model,
  fieldName,
  fieldValue,
  sortFieldName,
  ignoreCases,
  noOfCharsToIncreaseOnSaturation,
}) {
  if (!model.schema.options.sortEncryptedFieldsOptions.silent)
    console.time(`mongoose-sort-encrypted-field -> updateSortFieldsForDocument() -> objectId: ${objectId}, timeTaken: `);
  const { predecessorSortId, successorSortId } = await documentsBinarySearch(model, fieldName, fieldValue, sortFieldName, ignoreCases);
  const newSortId = getAverageSortId(predecessorSortId, successorSortId, noOfCharsToIncreaseOnSaturation);
  await model.updateOne({ _id: objectId }, { $set: { [sortFieldName]: newSortId.toString() } });
  const documentsCountWithSameSortId = await model
    .find({ [sortFieldName]: newSortId.toString() })
    .count()
    .exec();
  if (documentsCountWithSameSortId > 1) {
    if (!model.schema.options.sortEncryptedFieldsOptions.silent)
      console.log(`mongoose-sort-encrypted-field -> Got collions, retrying... objectId: ${objectId}`);
    // Retrigering sortId generation due to collion
    throw `mongoose-sort-encrypted-field -> Got collions, retrying... objectId: ${objectId}`;
  }
  if (!model.schema.options.sortEncryptedFieldsOptions.silent)
    console.timeEnd(`mongoose-sort-encrypted-field -> updateSortFieldsForDocument() -> objectId: ${objectId}, timeTaken: `);
}

async function generateSortIdForAllDocuments({ model, fieldName, sortFieldName, ignoreCases }) {
  if (!model.schema.options.sortEncryptedFieldsOptions.silent)
    console.time("mongoose-sort-encrypted-field -> generateSortIdForAllDocuments() -> timeTaken: ");
  const patients = await model.find({}, { [fieldName]: 1 }).exec();
  patients.sort((a, b) => {
    let aValue = a[fieldName];
    let bValue = b[fieldName];
    aValue = ignoreCases ? aValue.toLowerCase() : aValue;
    bValue = ignoreCases ? bValue.toLowerCase() : bValue;
    return aValue.localeCompare(bValue);
  });
  const n = patients.length;
  const log2n = Math.round(Math.log2(n)) + 1;
  let diff = new Base2N("".padEnd(50, "\uffff"));
  for (let i = 0; i < log2n; i++) {
    diff = diff.half();
  }
  let curr = new Base2N("\0");
  curr = curr.add(diff);
  for (let i = 0; i < n; i += 1) {
    await model.updateOne({ _id: patients[i]._id }, { $set: { [sortFieldName]: curr.toString() } });
    curr = curr.add(diff);
  }
  if (!model.schema.options.sortEncryptedFieldsOptions.silent)
    console.timeEnd("mongoose-sort-encrypted-field -> generateSortIdForAllDocuments() -> timeTaken: ");
}