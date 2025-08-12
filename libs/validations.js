const vatPatterns = require("./patterns");
const {getInfofromKVKNumber} =require("./utils")
function isInvoiceDocument(jsonData) {
  const invoiceTerms = [
    "factuur",
    "invoice",
    "nota",
    "order",
    "pakbon",
    "bon",
    "kassabon",
  ];
  const financialTerms = [
    "€",
    ",",
    "excl btw",
    " btw",
    "21%",
    "9%",
    "0%",
    "totaal",
    "subtotaal",
  ];
  const numberRegex = /\d+,\d+|\d+\.\d+/; // Matches numbers with comma or dot as decimal separator

  if (!jsonData) {
    console.log("Invalid JSON data or Pages not found");
    return false;
  }

  let hasInvoiceTerm = invoiceTerms.some((term) => jsonData.includes(term));
  let hasFinancialTerm =
    financialTerms.some((term) => jsonData.includes(term)) ||
    numberRegex.test(jsonData);

  return hasInvoiceTerm || hasFinancialTerm;
}

function findValueByKey(obj, key) {
  if (obj.hasOwnProperty(key)) return obj[key]; // If the key is directly in the current object

  for (let prop in obj) {
    if (obj[prop] && typeof obj[prop] === "object") {
      let result = findValueByKey(obj[prop], key); // Recursively search in sub-objects
      if (result) return result; // Return the found value
    }
  }

  return null; // Return null if the key is not found
}

function updateValueByKey(obj, key, newValue) {
  if (obj.hasOwnProperty(key)) {
    obj[key] = newValue; // Update the value if the key is directly in the object
    return obj; // Return the updated object
  }

  for (let prop in obj) {
    if (obj[prop] && typeof obj[prop] === "object") {
      let updated = updateValueByKey(obj[prop], key, newValue);
      if (updated) {
        obj[prop] = updated; // Update the sub-object
      }
    }
  }

  return obj; // Always return the full object
}
function findValueWithSameY(jsonData, targetText) {
  let targetY = null;
  let result = null;

  // Ensure jsonData and jsonData.Pages are defined
  if (!jsonData || !jsonData.Pages) {
    console.log("Invalid JSON data or Pages not found");
    return null;
  }

  // Search for the target text and its "y" value
  jsonData.Pages.forEach((page) => {
    page.Texts.forEach((text) => {
      text.R.forEach((r) => {
        if (r.T === targetText) {
          targetY = text.y;
        }
      });
      if (targetY !== null) {
        // Search for any text with the same "y" value
        page.Texts.forEach((text) => {
          if (text.y === targetY && text.R[0].T !== targetText) {
            result = text.R[0].T;
          }
        });
      }
    });
  });

  return result;
}

function updateKVK(jsondata, valideData) {
  const value = findValueWithSameY(valideData, "K.v.K.");
  const updatedJsonData = updateValueByKey(jsondata, "kvk", value);
  return updatedJsonData;
}

function ValidateKVK(jsondata, valideData) {
  const kvkValue = findValueByKey(jsondata, "kvk_number");
  if (kvkValue === null) {
    console.log("There is not exist kvk (AI)");
  } else if (kvkValue.trim().length === 8) {
    console.log("kvk is valid!");
  } else {
    const updatedJsonData = updateKVK(jsondata, valideData);
    return updatedJsonData;
  }
  return jsondata;
}

function updateVAT(jsondata, valideData) {
  const value = findValueWithSameY(valideData, "BTWnr.");
  const formattedValue = value.replace(/[.]+|%20/g, "");
  const updatedJsonData = updateValueByKey(
    jsondata,
    "vat_number",
    formattedValue
  );
  return updatedJsonData;
}

function validateVAT(jsondata, valideData) {
  const countryCode = findValueByKey(jsondata, "sender_country");
  const vatNumber = findValueByKey(jsondata, "vat_number");

  if (countryCode === null && vatNumber === null)
    console.log("There is not exist vat number or sender country");
  else {
    const pattern = vatPatterns[countryCode];
    if (pattern ? pattern.test(vatNumber) : false) {
      console.log("VAT is Valid!");
      return jsondata;
    } else {
      const updatedJsonData = updateVAT(jsondata, valideData);
      console.log("VAT is not Valid! Updated!");
      return updatedJsonData;
    }
  }
  return jsondata;
}

function validateItemTotals(jsondata, validData) {
  const items = jsondata.invoice.items;
  let isValid = true;
  items.forEach((item) => {
    const calculatedExclVat = item.quantity * item.item_unit_price;
    const vatPercentage = parseFloat(item.item_vat_percentage) / 100;
    const calculatedInclVat = calculatedExclVat * (1 + vatPercentage);
    console.log(calculatedInclVat.toFixed(2));
    console.log(item.item_amount_incl_vat.toFixed(2));

    if (
      calculatedExclVat.toFixed(2) != item.item_amount_excl_vat.toFixed(2) ||
      calculatedInclVat.toFixed(2) != item.item_amount_incl_vat.toFixed(2)
    ) {
      console.log(`Item ${item.article_number} has incorrect totals.`);
      isValid = false;
    }
  }
);

  if (isValid) {
    console.log("All item totals are valid.");
  } else {
    console.log("Some item totals are incorrect.");
  }

  return jsondata;
}

function validateTotals(jsondata, validData) {
  const invoice = jsondata.invoice;
  const items = invoice.items;

  // Calculate the sum of item subtotals
  const calculatedSubtotal = items.reduce((sum, item) => sum + item.item_amount_excl_vat, 0);

  // Validate subtotal
  if (calculatedSubtotal !== invoice.subtotal_amount_excl_vat) {
      console.log('Subtotal amount does not match the sum of item subtotals.');
      return jsondata;
  }

  // Calculate total amount including VAT
  const vatPercentage = parseFloat(items[0].item_vat_percentage) / 100;
  const calculatedTotal = invoice.subtotal_amount_excl_vat * (1 + vatPercentage);

  // Validate total amount including VAT
  if (calculatedTotal.toFixed(2) !== invoice.total_amount_incl_vat.toFixed(2)) {
      console.log( 'Total amount including VAT is incorrect.' );
      return jsondata;
  }

  console.log('Invoice totals are valid.' );
  return jsondata;
}

function validateSenderOrReciver(jsondata,companyInfo){
  let valid=true;
  if(jsondata.sender.company!==companyInfo["Bestaande handelsnaam"]){
    console.log("sender is incorrect ");
    valid = false;
  }

  return jsondata
}

 async function validateInvoiceData(data, validData) {
  const jsonData = JSON.parse(data);
  const jsonData2pdf = JSON.parse(validData);
  //check pdf is invoices.
  if (!isInvoiceDocument(validData.toLowerCase())) {
    console.log("it looks like this is not an invoice, we can not extract it");
    return false;
  } else console.log("PDF is valid!");

  //check KVK
  const dataCheckedKVK = ValidateKVK(jsonData, jsonData2pdf);

  //check VAT
  const dataCheckedVAT = validateVAT(dataCheckedKVK, jsonData2pdf);

  //check Item Total
  const dataCheckedItemTotals = validateItemTotals(dataCheckedVAT , jsonData2pdf);

  //Check Total
  const dataCheckedTotals = validateTotals(dataCheckedItemTotals , jsonData2pdf);
  
  const companyInfo = await getInfofromKVKNumber("50035592");
  console.log(companyInfo);
  const dataCheckedSenderOrRecieverByKVK= validateSenderOrReciver(dataCheckedTotals,companyInfo[0]);

  return dataCheckedSenderOrRecieverByKVK;
}

module.exports = {
  validateInvoiceData,
};
