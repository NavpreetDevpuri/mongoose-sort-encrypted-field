const { add, shift } = require("math-buffer");

class SortIdManager {
  model: any;
  fieldName: string;
  sortFieldName: string;
  silent: boolean;
  ignoreCases: boolean;
  noOfBytesForSortId: number;
  noOfBytesToIncreaseOnSaturation: number;
  constructor(model, fieldName, sortFieldName) {
    this.model = model;
    this.fieldName = fieldName;
    this.sortFieldName = sortFieldName;
    const { silent, ignoreCases, noOfBytesForSortId, noOfBytesToIncreaseOnSaturation } = model.schema.options.sortEncryptedFieldsOptions;
    this.silent = silent;
    this.ignoreCases = ignoreCases;
    this.noOfBytesForSortId = noOfBytesForSortId;
    this.noOfBytesToIncreaseOnSaturation = noOfBytesToIncreaseOnSaturation;
  }

  async getDocument(skip) {
    return this.model
      .findOne({ [this.sortFieldName]: { $ne: null } }, { [this.fieldName]: 1, [this.sortFieldName]: 1 })
      .sort({ [this.sortFieldName]: 1 })
      .skip(skip)
      .exec();
  }

  getAverageSortId(predecessorSortId: Buffer, successorSortId: Buffer) {
    if (!predecessorSortId) {
      predecessorSortId = Buffer.from("".padEnd(2 * successorSortId.length, "0"), "hex");
    }
    if (!successorSortId) {
      successorSortId = Buffer.from("".padEnd(2 * predecessorSortId.length, "f"), "hex");
    }
    predecessorSortId.reverse();
    successorSortId.reverse();
    if (predecessorSortId.length === successorSortId.length) {
      if (add(predecessorSortId, Buffer.from([0x01])).equals(successorSortId)) {
        predecessorSortId = Buffer.concat([Buffer.from("".padEnd(2 * this.noOfBytesToIncreaseOnSaturation, "0"), "hex"), predecessorSortId]);
        successorSortId = Buffer.concat([Buffer.from("".padEnd(2 * this.noOfBytesToIncreaseOnSaturation, "0"), "hex"), successorSortId]);
      }
      let averageSortId = add(shift(predecessorSortId, -1), shift(successorSortId, -1));
      if (averageSortId[averageSortId.length - 1] === 0 && averageSortId.length > predecessorSortId.length) {
        averageSortId = averageSortId.slice(0, averageSortId.length - 1);
      }
      averageSortId.reverse();
      return averageSortId;
    }

    const biggerSortId = predecessorSortId.length > successorSortId.length ? predecessorSortId : successorSortId;
    let smallerSortId = successorSortId.length > predecessorSortId.length ? predecessorSortId : successorSortId;

    smallerSortId = Buffer.concat([Buffer.from("".padEnd(2 * (biggerSortId.length - smallerSortId.length), "0"), "hex"), smallerSortId]);
    let averageSortId = add(shift(predecessorSortId, -1), shift(successorSortId, -1));
    if (averageSortId[averageSortId.length - 1] === 0 && averageSortId.length > biggerSortId.length) {
      averageSortId = averageSortId.slice(0, averageSortId.length - 1);
    }
    averageSortId.reverse();
    return averageSortId;
  }

  async generateSortIdUsingBinarySearch(fieldValue) {
    fieldValue = fieldValue || "";
    fieldValue = this.ignoreCases ? fieldValue.toLowerCase() : fieldValue;
    const n = await this.model
      .findOne({ [this.sortFieldName]: { $ne: null } })
      .count()
      .exec();
    if (n === 0) {
      const predecessorSortId = Buffer.from("".padEnd(2 * this.noOfBytesForSortId, "0"), "hex");
      const successorSortId = Buffer.from("".padEnd(2 * this.noOfBytesForSortId, "f"), "hex");
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
    let diff = Buffer.from("".padEnd(2 * this.noOfBytesForSortId, "f"), "hex");
    for (let i = 0; i < log2n; i += 1) {
      diff = shift(diff, -1);
    }
    let curr = Buffer.from("".padEnd(2 * this.noOfBytesForSortId, "0"), "hex");
    for (let i = 0; i < n; i += 1) {
      if (i === 0 || documents[i - 1][this.fieldName] !== documents[i][this.fieldName]) {
        curr = add(curr, diff);
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
