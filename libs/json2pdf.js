const fs = require("fs");
const PDFParser = require("pdf2json");

function parsePDFtoJSON(inputPDF, callback) {
  const pdfParser = new PDFParser();

  pdfParser.on("pdfParser_dataError", errData =>
    console.error(errData.parserError)
  );

  pdfParser.on("pdfParser_dataReady", pdfData => {
    callback(JSON.stringify(pdfData)); // Return JSON data via callback
  });

  pdfParser.loadPDF(inputPDF);
}

module.exports = {
    parsePDFtoJSON
};
