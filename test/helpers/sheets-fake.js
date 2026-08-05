'use strict';

function createSheet(name) {
  const data = [];

  function ensureRow(index) {
    while (data.length <= index) data.push([]);
    return data[index];
  }

  return {
    _data: data,
    getName: () => name,
    getLastRow: () => data.length,
    getLastColumn: () => data.reduce((max, row) => Math.max(max, row.length), 0),
    appendRow(values) {
      data.push(values.slice());
    },
    deleteRow(row) {
      data.splice(row - 1, 1);
    },
    getRange(row, col, numRows, numCols) {
      const rows = numRows || 1;
      const cols = numCols || 1;
      return {
        getValue() {
          const line = data[row - 1];
          const value = line ? line[col - 1] : undefined;
          return value === undefined ? '' : value;
        },
        getValues() {
          const out = [];
          for (let r = 0; r < rows; r += 1) {
            const line = [];
            for (let c = 0; c < cols; c += 1) {
              const source = data[row - 1 + r];
              const value = source ? source[col - 1 + c] : undefined;
              line.push(value === undefined ? '' : value);
            }
            out.push(line);
          }
          return out;
        },
        setValues(values) {
          values.forEach((line, r) => {
            const target = ensureRow(row - 1 + r);
            line.forEach((value, c) => {
              target[col - 1 + c] = value;
            });
          });
          return this;
        },
      };
    },
  };
}

function createSpreadsheet() {
  const sheets = [];
  return {
    getSheetByName: (name) => sheets.find((s) => s.getName() === name) || null,
    getSheets: () => sheets.slice(),
    insertSheet(name) {
      const sheet = createSheet(name);
      sheets.push(sheet);
      return sheet;
    },
    deleteSheet(sheet) {
      const index = sheets.indexOf(sheet);
      if (index >= 0) sheets.splice(index, 1);
    },
  };
}

/** SpreadsheetApp 전역을 설치하고 빈 스프레드시트를 돌려준다. */
function installSpreadsheetApp(id) {
  const spreadsheet = createSpreadsheet();
  global.SpreadsheetApp = {
    openById(requestedId) {
      if (requestedId !== id) throw new Error('알 수 없는 스프레드시트 ID: ' + requestedId);
      return spreadsheet;
    },
  };
  return spreadsheet;
}

module.exports = { createSheet, createSpreadsheet, installSpreadsheetApp };
