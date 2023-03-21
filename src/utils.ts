const Base2N = require("@navpreetdevpuri/base-2-n");
async function documentsBinarySearch(model, fieldName, value, sortFieldName, ignoreCases) {
  const n = await model
    .findOne({ [sortFieldName]: { $ne: null } })
    .count()
    .exec();
  let start = 0;
  let end = n - 1;
  let startDoc = await model
    .findOne({ [sortFieldName]: { $ne: null } }, { [fieldName]: 1, [sortFieldName]: 1 })
    .sort({ [sortFieldName]: 1 })
    .skip(start)
    .exec();
  let midDoc;
  let endDoc = await model
    .findOne({ [sortFieldName]: { $ne: null } }, { [fieldName]: 1 })
    .sort({ [sortFieldName]: 1 })
    .skip(end)
    .exec();
  let startValue;
  let midValue;
  let endValue;

  while (start <= end) {
    const mid = Math.ceil((start + end) / 2);
    midDoc = await model
      .findOne({ [sortFieldName]: { $ne: null } }, { [fieldName]: 1 })
      .sort({ [sortFieldName]: 1 })
      .skip(mid)
      .exec();

    startValue = String(startDoc[fieldName]);
    midValue = String(midDoc[fieldName]);
    endValue = String(endDoc[fieldName]);
    startValue = ignoreCases ? startValue.toLowerCase() : startValue;
    midValue = ignoreCases ? midValue.toLowerCase() : midValue;
    endValue = ignoreCases ? endValue.toLowerCase() : endValue;

    if (value < midValue) {
      end = mid - 1;
      endDoc = await model
        .findOne({ [sortFieldName]: { $ne: null } }, { [fieldName]: 1 })
        .sort({ [sortFieldName]: 1 })
        .skip(end)
        .exec();
    } else if (midValue <= value) {
      start = mid + 1;
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
      .sort({ [sortFieldName]: -1 })
      .exec();
    return {
      predecessorSortId: startDoc[sortFieldName],
      successorSortId: null,
    };
  }

  let predecessorDoc = endDoc;
  const successorDoc = startDoc;

  if (end === start - 1) {
    predecessorDoc = await model
      .findOne({ [sortFieldName]: { $ne: null } }, { [sortFieldName]: 1 })
      .sort({ [sortFieldName]: 1 })
      .skip(end)
      .exec();
  }

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
  console.time(`Total time took to update orderId: ${objectId}`);
  const { predecessorSortId, successorSortId } = await documentsBinarySearch(model, fieldName, fieldValue, sortFieldName, ignoreCases);
  const newSortId = getAverageSortId(predecessorSortId, successorSortId, noOfCharsToIncreaseOnSaturation);
  await model.updateOne({ _id: objectId }, { $set: { [sortFieldName]: newSortId.toString() } });
  const documentsCountWithSameSortId = await model
    .find({ [sortFieldName]: newSortId.toString() })
    .count()
    .exec();
  if (documentsCountWithSameSortId > 1) {
    console.log(`mongoose-sort-encrypted-field -> Got collions, retrying... ${objectId}`);
    // Retrigering sortId generation due to collion
    const documentsWithSameSortId = await model.find({ [sortFieldName]: newSortId.toString() }, { [fieldName]: 1 }).exec();
    for (const document of documentsWithSameSortId) {
      await model.updateOne({ _id: objectId }, { $set: { [fieldName]: document[fieldName] } });
    }
  }
  console.timeEnd(`Total time took to update orderId: ${objectId}`);
}

export { documentsBinarySearch, getAverageSortId, updateSortFieldsForDocument };
