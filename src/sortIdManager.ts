import Base2N from "@navpreetdevpuri/base-2-n";

class SortIdManager {
  model: any;
  fieldName: string;
  sortFieldName: string;
  silent: boolean;
  ignoreCases: boolean;
  noOfCharsForSortId: number;
  noOfCharsToIncreaseOnSaturation: number;
  base = 15;
  constructor(model, fieldName, sortFieldName) {
    this.model = model;
    this.fieldName = fieldName;
    this.sortFieldName = sortFieldName;
    const { silent, ignoreCases, noOfCharsForSortId, noOfCharsToIncreaseOnSaturation } = model.schema.options.sortEncryptedFieldsOptions;
    this.silent = silent;
    this.ignoreCases = ignoreCases;
    this.noOfCharsForSortId = noOfCharsForSortId;
    this.noOfCharsToIncreaseOnSaturation = noOfCharsToIncreaseOnSaturation;
  }

  async getDocument(skip) {
    return this.model
      .findOne({ [this.sortFieldName]: { $ne: null } }, { [this.fieldName]: 1, [this.sortFieldName]: 1 })
      .sort({ [this.sortFieldName]: 1 })
      .skip(skip)
      .exec();
  }

  getAverageSortId(predecessorSortId, successorSortId) {
    if (!predecessorSortId) {
      predecessorSortId = "".padEnd(successorSortId.length, "\0");
    }

    if (!successorSortId) {
      successorSortId = "".padEnd(predecessorSortId.length, "\u7FFF");
    }

    let predecessorNumber;
    let successorNumber;

    if (predecessorSortId.length === successorSortId.length) {
      predecessorNumber = new Base2N(predecessorSortId, this.base);
      successorNumber = new Base2N(successorSortId, this.base);
      let averageNumber = predecessorNumber.average(successorNumber);
      if (averageNumber.toString() !== predecessorNumber.toString()) {
        return averageNumber.toString();
      }
      const newSize = averageNumber.length + this.noOfCharsToIncreaseOnSaturation;
      predecessorNumber = new Base2N(predecessorSortId.padEnd(newSize, "\0"), this.base);
      successorNumber = new Base2N(successorSortId.padEnd(newSize, "\0"), this.base);
      averageNumber = predecessorNumber.average(successorNumber);
      return averageNumber.toString();
    }

    const bigger = predecessorSortId.length > successorSortId.length ? predecessorSortId : successorSortId;
    const smaller = successorSortId.length > predecessorSortId.length ? predecessorSortId : successorSortId;

    const biggerNumber = new Base2N(bigger, this.base);
    const smallerNumber = new Base2N(smaller.padEnd(bigger.length, "\0"), this.base);
    const averageNumber = biggerNumber.average(smallerNumber);
    return averageNumber.toString();
  }

  async generateSortIdUsingBinarySearch(fieldValue) {
    fieldValue = fieldValue || "";
    fieldValue = this.ignoreCases ? fieldValue.toLowerCase() : fieldValue;
    const n = await this.model
      .findOne({ [this.sortFieldName]: { $ne: null } })
      .count()
      .exec();
    if (n === 0) {
      const predecessorSortId = "".padEnd(this.noOfCharsForSortId, "\0");
      const successorSortId = "".padEnd(this.noOfCharsForSortId, "\u7FFF");
      return this.getAverageSortId(predecessorSortId, successorSortId);
    }
    let start = 0;
    let end = n - 1;
    let startDoc = await this.getDocument(start);
    let midDoc;
    let endDoc = await this.getDocument(end);
    let startValue;
    let midValue;
    let endValue;

    while (start <= end) {
      const mid = Math.floor((start + end) / 2);
      midDoc = await this.getDocument(mid);

      startValue = startDoc[this.fieldName] || "";
      midValue = midDoc[this.fieldName] || "";
      endValue = endDoc[this.fieldName] || "";
      startValue = this.ignoreCases ? startValue.toLowerCase() : startValue;
      midValue = this.ignoreCases ? midValue.toLowerCase() : midValue;
      endValue = this.ignoreCases ? endValue.toLowerCase() : endValue;
      if (fieldValue === midValue) {
        return midDoc[this.sortFieldName];
      } else if (fieldValue < midValue) {
        end = mid - 1;
        if (end < 0) {
          break;
        }
        endDoc = await this.getDocument(end);
      } else if (midValue < fieldValue) {
        start = mid + 1;
        if (start === n) {
          break;
        }
        startDoc = await this.getDocument(start);
      }
    }

    if (start === 0) {
      return this.getAverageSortId(null, startDoc[this.sortFieldName]);
    }

    if (start === n) {
      startDoc = await this.getDocument(start - 1);
      return this.getAverageSortId(startDoc[this.sortFieldName], null);
    }

    endDoc = await this.getDocument(start - 1);
    return this.getAverageSortId(endDoc[this.sortFieldName], startDoc[this.sortFieldName]);
  }

  async updateSortFieldsForDocument(objectId, fieldValue) {
    if (!this.silent) {
      console.time(
        `mongoose-sort-encrypted-field -> updateSortFieldsForDocument() -> objectId: ${objectId}, fieldName: ${this.fieldName}, sortFieldName: ${this.sortFieldName}, timeTaken: `
      );
    }
    const newSortId = await this.generateSortIdUsingBinarySearch(fieldValue);
    await this.model.updateOne({ _id: objectId }, { $set: { [this.sortFieldName]: newSortId } });
    if (!this.silent) {
      console.timeEnd(
        `mongoose-sort-encrypted-field -> updateSortFieldsForDocument() -> objectId: ${objectId}, fieldName: ${this.fieldName}, sortFieldName: ${this.sortFieldName}, timeTaken: `
      );
    }
  }

  async updateSortIdForAllDocuments() {
    if (!this.silent) {
      console.time(
        `mongoose-sort-encrypted-field -> generateSortIdForAllDocuments() -> fieldName: ${this.fieldName}, sortFieldName: ${this.sortFieldName}, timeTaken: `
      );
    }
    const documents = await this.model.find({}, { [this.fieldName]: 1 }).exec();
    documents.sort((a, b) => {
      let aValue = a[this.fieldName] || "";
      let bValue = b[this.fieldName] || "";
      aValue = this.ignoreCases ? aValue.toLowerCase() : aValue;
      bValue = this.ignoreCases ? bValue.toLowerCase() : bValue;
      return aValue.localeCompare(bValue);
    });
    const n = documents.length;
    const log2n = Math.round(Math.log2(n)) + 1;
    let diff = new Base2N("".padEnd(this.noOfCharsForSortId, "\u7FFF"), this.base);
    for (let i = 0; i < log2n; i += 1) {
      diff = diff.half();
    }
    let curr = new Base2N("".padEnd(this.noOfCharsForSortId, "\0"), this.base);
    for (let i = 0; i < n; i += 1) {
      if (i === 0 || documents[i - 1][this.fieldName] !== documents[i][this.fieldName]) {
        curr = curr.add(diff);
      }
      await this.model.updateOne({ _id: documents[i]._id }, { $set: { [this.sortFieldName]: curr.toString() } });
    }
    if (!this.silent) {
      console.timeEnd(
        `mongoose-sort-encrypted-field -> generateSortIdForAllDocuments() -> fieldName: ${this.fieldName}, sortFieldName: ${this.sortFieldName}, timeTaken: `
      );
    }
  }
}

export { SortIdManager };
