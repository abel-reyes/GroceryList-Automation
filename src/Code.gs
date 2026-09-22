// * ==============================================================================
// * JAVASCRIPT & GOOGLE APPS SCRIPT FOUNDATIONS (Read this first!)
// * ==============================================================================
// *  1. COMMENTS:
// *     - Single-line Comments start with: //
// *     - Multi-line comments are wrapped in /* ... */
// *     Comments are completely ignored by the computer. They exist solely to 
// *     explain the code to humans.
// * 
// *  2. VARIABLES:
// *     Variables are named containers used to store data.
// *     - 'const' (Constant): A variable whose value cannot be reassigned later.
// *     - 'let': A variable whose value CAN be changed or updated later.
// *     - 'var': An older way to declare variables (mostly replaced by let/const).
// * 
// *  3. DATA TYPES:
// *     - String: text wrapped in quotes, like `'Staples'` or `"Grocery List"`. 
// *     - Number: Numbers without quotes, like `1`, `40`, `3.14`.
// *     - Boolean: Either `true` or `false`. 
// *     - Array: A list of items inside square brackets `[]`, e.g., `['apple', 'banana']`.
// *     - Object: A collection of key-value pairs inside curly braces `{}`, e.g., `{ name: "Abel", age: 30}`.
// * 
// *  4. FUNCTIONS:
// *     A function is a reusable block of code that performs a specific task. 
// *     Syntax: `function functionName(parameters) { ... code to run ...}`
// *     - Parameters (Inputs): Values you pass into a function to use inside it.
// *     - `return` (Output): Sends a result back to wherever the function was called.
// * ==============================================================================
// * GROCERY LIST GENERATOR
// * ------------------------------------------------------------------------------
// * Pulls ingredients from bolded (i.e. "selected") recipes in your
// * master recipe Google Doc, combines them with a Staples tab and a
// * pasted-in Google Keep tab, and writes a fresh grocery list.
// *
// * SETUP (one time):
// * 1. Open your Grocery List Google SHEET.
// * 2. Extensions > Apps Script. Delete any placeholder code, paste
// *    this whole file in, and save.
// * 3. In the Apps Script editor: click "Services" (+ icon) on the
// *    left sidebar > find "Google Docs API" > Add. This gives the
// *    script access to see ALL tabs in your recipe doc (the normal
// *    DocumentApp service can only see the first/default tab).
// * 4. Fill in the CONFIG block below with your real values.
// * 5. In your Sheet, make sure you have three tabs (exact names, or
// *    update CONFIG to match what you use):
// *      - "Staples"     -> one ingredient per row, column A
// *      - "Keep Items"  -> paste your Keep list here, one item per row
// *      - "Grocery List"-> this gets overwritten each run; ok if empty/missing
// * 6. Reload the Sheet. You'll see a new menu: "🛒 Grocery List".
// *    Click it > "Generate List".
// * ------------------------------------------------------------------------------

// ------------------------------------------------------------------------------
// CONFIGURATION OBJECT
// ------------------------------------------------------------------------------
// `const CONFIG = { ... }` creates a single JavaScript Object storing setting values. 
// This allows you to update IDs or sheet names in one central place without hunting
// through hundreds of lines of code.
const CONFIG = {
  // Key: Value pairs. Access these later using dot notation: CONFIG.RECIPE_DOC_ID
  RECIPE_DOC_ID: 'YOUR_RECIPE_DOC_ID_HERE',                          // From the doc's URL
  CONTENTS_TAB_TITLE: 'Table of Recipes',                            // Exact tab title in the recipe doc
  KEEP_PASTE_DOC_ID: 'YOUR_KEEP_PASTE_DOC_ID_HERE',                  // Separate, single-tab doc you paste your Keep note into
  GROCERY_SHEET_ID: 'YOUR_GROCERY_SHEET_ID_HERE',                    // this Sheet's own ID, from its URL
  STAPLES_SHEET_NAME: 'Staples',                                     // Reference sheet containing 'Staples', items you want included each time the list generates
  KEEP_SHEET_NAME: 'Keep Items',                                     // Reference sheet where Keep Doc populates contents into
  OUTPUT_SHEET_NAME: 'Grocery List',                                 // Sheet that receives the information for further sorting
  LOCATION_REFERENCE_SHEET_NAME: 'Item Location Reference',          // Sheet with a list of items, their locations, and if they are a kitchen staple. Keyword (col A) -> Location (col B), most specific keyword first.
  ROUTE_SHEET_NAME: 'Route',                                         // Sheet with the finalized list of items showing in order of location and if they are a kitchen staple
};

// ------------------------------------------------------------------------------
// PROTEIN DETECTION & QUANTITY PRESERVATION CONFIGURATION
// ------------------------------------------------------------------------------
// ARRAY OF STRINGS: Keywords used to detect protein items.
// When an ingredient contains any of these words, its full quantity (e.g., "4 Breasts")
// is retained in the display string rather than being stripped out by regex.
const PROTEIN_KEYWORDS = [
  'chicken', 'beef', 'pork', 'turkey', 'salmon', 'tuna', 'shrimp', 
  'steak', 'ground beef', 'ground turkey', 'pork chop', 'bacon', 
  'sausage', 'lamb', 'cod', 'tilapia', 'tofu', 'thigh', 'thighs', 
  'breast', 'breasts', 'wing', 'wings', 'roast', 'tenderloin'
];

/**
 * HELPER: Checks if a raw ingredient line contains any protein keyword.
 * Returns `true` if a match is found, or `false` if none match.
 */
function isProteinItem(raw) {
  const lower = raw.toLowerCase();
  // `.some()` iterates through PROTEIN_KEYWORDS and returns true if at least one keyword exists in the string
  return PROTEIN_KEYWORDS.some(function (keyword) {
    return lower.indexOf(keyword) !== -1;
  });
}

// ------------------------------------------------------------------------------
// REGULAR EXPRESSIONS (REGEX) & INGREDIENT CLEANING
// ------------------------------------------------------------------------------
// REGULAR EXPRESSION (RegEx): A pattern used to match character combinations in text strings.
// `new RegExp(pattern, flags)` builds a dynamic text search pattern.
// Flag `'i'`: Case-insensitive search (matches uppercase or lowercase).
// Strips a leading quantity + common unit words so "2 eggs" and "3 large eggs" both group under "eggs".
const QUANTITY_UNIT_REGEX = new RegExp(
  '^\\s*' +                                                                   // ^ = start of string, \s* = optional leading space
  '(?:(?:a|an)\\b\\s*)?' +                                                    // Optional words "a" or "an"
  '[\\d\\.\\/\\-\\s¼½¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]*\\s*' +                                    // Numbers, fractions, decimals, spaces
  '(?:(?:cups?|tbsps?|tablespoons?|tsps?|teaspoons?|oz|ounces?|lbs?|pounds?|g|grams?|kg|ml|l|liters?|' +
  'pinch(?:es)?|dash(?:es)?|cloves?|slices?|cans?|packages?|pkgs?|bunch(?:es)?|heads?|large|medium|small)\\b)?\\s*' + // Units
  '(?:of\\s+)?',                                                              // Optional trailing "of "
  'i'
);

/**
 * HELPER: Cleans ingredient text based on item type.
 * @param {string} raw - The raw uncleaned ingredient string.
 * @param {boolean} keepQuantity - Second parameter passed from groupIngredients.
 * If true (proteins), bypasses quantity stripping and returns the intact raw text.
 */
function normalizeIngredient(raw, keepQuantity) {
  // If it's a protein item (`keepQuantity` is true), preserve the original text with its quantity/unit intact
  if (keepQuantity) {
    return raw.trim();
  }

  // Standard quantity stripping for all non-protein ingredients
  // `.replace(pattern, replacement)` replaces matched regex pattern with empty space `''`
  let cleaned = raw.replace(QUANTITY_UNIT_REGEX, '').trim();
  if (cleaned.length === 0) cleaned = raw.trim(); // Fallback if regex over-cleared string

  // Standardize singular text variations to plural using word boundary patterns `\b`
  cleaned = cleaned
    .replace(/\begg\b/i, 'Eggs')
    .replace(/\bclove\b/i, 'Cloves')
    .replace(/\bcarrot\b/i, 'Carrots');

  return cleaned;
}

function toTitleCase(s) {
  // Converts string like "ground beef" to Title Case ("Ground Beef")
  // `\w\S*` matches word character chunks
  return s.replace(/\w\S*/g, function (w) {
    // `.charAt(0)` gets 1st character, `.slice(1)` gets remainder of string
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  });
}

// ------------------------------------------------------------------------------
// HELPER: OPEN SPREADSHEET
// ------------------------------------------------------------------------------
// Context: Opens the Grocery Sheet by ID rather than relying on "active spreadsheet."
// getActiveSpreadsheet() only works when the script runs from inside the Sheet's
// own menu -- it has no meaning when triggered from the standalone web app (phone)
// UI, which has no "active" document open. Using openById makes every function work 
// identically from the menu or from the web app.
function getGrocerySpreadsheet() {
  // `SpreadsheetApp` is built into Google Apps Script.
  // Dot notation `.openById(...)` calls a method (action) on SpreadsheetApp.
  // `return` sends the opened file back to whatever code called this function.
  return SpreadsheetApp.openById(CONFIG.GROCERY_SHEET_ID);
}

// ------------------------------------------------------------------------------
// WEB APP ENTRY POINT (for mobile/browser access)
// ------------------------------------------------------------------------------
// `doGet(e)` is a special reserved function name in Google Apps Script.
// Whenever someone opens the script's Web App URL, Google automatically runs `doGet`. 
// `e` stands for "event", an object holding details about the incoming HTTP request.
function doGet(e) {
  // `HtmlService.createHtmlOutputFromFile('Index')` loads an 'Index.html' file.
  // Methods can be chained together using dot (`.setTitle().addMetaTag()`).
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Grocery List')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ------------------------------------------------------------------------------
// CUSTOM MENU CREATION
// ------------------------------------------------------------------------------
// `onOpen()` is another special trigger function in Google Apps Script.
// It automatically executes every time the Google Sheet is opened by a user. 
function onOpen() {
  // Get the User Interface (UI) environment of the active spreadsheet
  SpreadsheetApp.getUi() 
    .createMenu('🛒 Grocery List')
    .addItem('Generate List', 'generateGroceryList')            // Add menu item (Label, Function Name to run)
    .addItem('Sync Keep Paste Doc', 'syncKeepFromDoc')          
    .addToUi();                                                 // Render menu on the toolbar
}

// ------------------------------------------------------------------------------
// STRIKETHROUGH DETECTION HELPER
// ------------------------------------------------------------------------------
// Parameter `textElement`: The text block passed into the function to check.
function getStrikethroughStatus(textElement) {
  // `.getText().length` counts the total number of characters in the element.
  const length = textElement.getText().length;

  // CONDITIONAL STATEMENT (if / return):
  // `===` checks for strict equality (is length exactly equal to 0?).
  if (length === 0) return false; // Empty text cannot be struck-through.

  // Check if the entire block of text has strikethrough applied.
  const whole = textElement.isStrikethrough();

  // `!==` means "Is NOT equal to". `null` means "no value exists".
  if (whole !== null) {
    // `!!` (Double NOT): A JavaScript trick to force any value into a pure Boolean (true/false).
    return !!whole; 
  }

  // Fallback: If text has mixed styling within one line, check character index 0 (1st letter).
  // Note: In programming, counting starts at 0, not 1!
  return !!textElement.isStrikethrough(0);
}

// ------------------------------------------------------------------------------
// SYNC KEEP DOC LOGIC
// ------------------------------------------------------------------------------
function runSyncKeepFromDoc() {
  // `DocumentApp.openById(...)` opens a Google Doc using its ID from CONFIG.
  const doc = DocumentApp.openById(CONFIG.KEEP_PASTE_DOC_ID);
  
  // Get the structural body section of the Google Doc.
  const body = doc.getBody();
  
  // Count how many structural elements (paragraphs, lists, images) are in the body.
  const numChildren = body.getNumChildren();
  
  // Initialize an empty Array `[]` to store items that aren't checked off.
  const uncheckedItems = [];

  // FOR LOOP: Repeats a block of code a set number of times.
  // Syntax: for (start; condition; increment)
  // `let i = 0`: Start counter `i` at zero.
  // `i < numChildren`: Keep looping as long as `i` is less than total items.
  // `i++`: Add 1 to `i` after every completed loop iteration.
  for (let i = 0; i < numChildren; i++) {
    const child = body.getChild(i);       // Get item at current index position `i`
    const type = child.getType();         // Get element type (Paragraph, Table, ListItem, etc.)

    // Only bulleted list items are real Keep items -- the note title and plain paragraphs get skipped.
    if (type !== DocumentApp.ElementType.LIST_ITEM) continue;

    // Convert list item element to editable text format
    const textElement = child.asListItem().editAsText();

    // `.trim()` removes leading and trailing whitespaces/newlines from text.
    const text = textElement.getText().trim();

    // `!text` means "if text is empty or falsey". If empty, skip it.
    if (!text) continue;

    // Call our custom function above to check if the item is struck through
    const isChecked = getStrikethroughStatus(textElement);

    // `!isChecked` means "if isChecked is false" (un-strikethrough item)
    if (!isChecked) {
      // `.push(...)` adds a new item to the end of an Array.
      uncheckedItems.push(toTitleCase(text));
    }
  }
  
  // Get the target Google Sheet file
  const ss = getGrocerySpreadsheet();

  // Get tab by name
  let sheet = ss.getSheetByName(CONFIG.KEEP_SHEET_NAME);

  // IF / ELSE STATEMENT:
  // If sheet doesn't exist (`!sheet`), create it. Otherwise, clear its existing contents.
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.KEEP_SHEET_NAME);
  } else {
    sheet.clearContents(); // Erase cell text/values, but keep format/colors
  }

  // Check if we found any unchecked items
  if (uncheckedItems.length > 0) {
    // `getRange(startRow, startColumn, numRows, numColumns)`
    // `.setValues()` requires a 2D Array (a list of rows, where each row is a list of columns): `[[row1_col1], [row2_col1]]`.
    // `.map()` transforms an array into a new format.
    // Here it transforms `['Eggs', 'Milk']` into `[['Eggs'], ['Milk']]`.
    sheet.getRange(1, 1, uncheckedItems.length, 1).setValues(
      uncheckedItems.map(function (t) { return [t]; })
    );
  }

  // CLEANUP DOC WORKAROUND:
  // `body.clear()` fails with "Can't remove the last paragraph in a document section"
  // when a doc consists entirely of bulleted items -- Docs always requires one plain paragraph.
  // Workaround: Append an empty paragraph first (satisfying Docs requirements), then remove all other elements.
  body.appendParagraph('');
  const childCountAfterAppend = body.getNumChildren();

  // Reverse For Loop: Deletes elements from bottom to top (prevents index shifts)
  for (let i = childCountAfterAppend - 2; i >= 0; i--) {
    body.removeChild(body.getChild(i));
  }

  // STRING CONCATENATION (+): Combines static strings and variables into one text string. 
  return 'Synced ' + uncheckedItems.length + ' unchecked Keep item(s) into "' + CONFIG.KEEP_SHEET_NAME + '". ' + 
    'Checked/struck-through items were skipped, and the paste doc has been cleared for next time.';
}

// ------------------------------------------------------------------------------
// WRAPPER FUNCTIONS (Sheet Menu vs. Web App)
// ------------------------------------------------------------------------------
function syncKeepFromDoc() { 
  const ui = SpreadsheetApp.getUi();

  // TRY...CATCH STATEMENT: Exception handling. 
  // Tries to execute code inside `try`. If an error occurs, jumps to `catch` without crashing the entire script. 
  try {
    // Show user a popup dialog message in the spreadsheet
    ui.alert(runSyncKeepFromDoc());
  } catch (e) {
    ui.alert('Something went wrong: ' + e.message);
    throw e; // Re-throws error to log execution details
  }
}

function webSyncKeepFromDoc() {
  return runSyncKeepFromDoc();
}

// ------------------------------------------------------------------------------
// MAIN GENERATOR LOGIC
// ------------------------------------------------------------------------------
function runGenerateGroceryList() {
  // AUTOMATIC EMAIL IMPORT:
  // Automatically imports and updates Keep Items from Gmail before generating the list
  pullKeepFromGmail();
  
  // Call Advanced Google Docs API to fetch raw structural data including tabs
  const doc = Docs.Documents.get(CONFIG.RECIPE_DOC_ID, { includeTabsContent: true });

  // `doc.tabs || []` uses Logical OR (`||`). If `doc.tabs` is undefined, fallback to an empty array `[]`.
  const tabs = flattenTabs(doc.tabs || []);

  const selectedTitles = getSelectedRecipeTitles(tabs);

  let allItems = []; // Declare reassignable variable `let`

  // CONDITIONAL BRANCHING: Check if any recipes were selected.
  // If selectedTitles has items, process recipe ingredients; otherwise log and move to Staples/Keep items.
  if (selectedTitles.length > 0) {
    // FOREACH LOOP: Runs a function on every single item inside an array.
    selectedTitles.forEach(function (title) {
      // `.concat()` merges two arrays together into one new combined array.
      allItems = allItems.concat(getIngredientsForRecipe(tabs, title));
    });
  } else {
    Logger.log('No bolded recipes found in "' + CONFIG.CONTENTS_TAB_TITLE + '". Generating list using only Staples and Keep items.');
  }

  // Load static staples and keep items from Google Sheets
  allItems = allItems.concat(getSheetColumnAsList(CONFIG.STAPLES_SHEET_NAME));
  const keepItems = getSheetColumnAsList(CONFIG.KEEP_SHEET_NAME);

  // Consolidate duplicates, format text, and assign metadata
  const grouped = groupIngredients(allItems, keepItems);

  // Write result back out to Google Sheets
  writeToSheet(grouped, selectedTitles);

  // Populate dynamic store navigation tab
  updateRouteSheet();

  return 'Grocery list generated: ' + grouped.length + ' items total (' + selectedTitles.length + ' recipe(s) selected).';
}

function generateGroceryList() {
  const ui = SpreadsheetApp.getUi();
  try {
    ui.alert(runGenerateGroceryList());
  } catch (e) {
    ui.alert('Something went wrong: ' + e.message);
    throw e; 
  }
}

function webGenerateGroceryList() {
  return runGenerateGroceryList();
}

// ------------------------------------------------------------------------------
// DOC READING HELPERS
// ------------------------------------------------------------------------------

// RECURSIVE FUNCTION: A function that calls ITSELF until a specific condition is met.
// Useful for nested structures like trees or nested tab hierarchies.
function flattenTabs(tabs) { 
  let result = [];
  tabs.forEach(function (tab) {
    result.push(tab);
    // If current tab has child tabs inside it...
    if (tab.childTabs && tab.childTabs.length > 0) {
      // Recurse: Call flattenTabs again on the child array and merge results
      result = result.concat(flattenTabs(tab.childTabs));
    }
  });
  return result;
}

function findTabByTitle(tabs, title) {
  // Convert target search title to lower case and trim spaces for safer matching 
  const target = title.trim().toLowerCase();

  // `.find()` searches an array and returns the FIRST item where the condition returns true.
  return tabs.find(function (t) {
    return t.tabProperties && t.tabProperties.title.trim().toLowerCase() === target;
  });
}

function paragraphText(paragraph) {
  if (!paragraph.elements) return '';

  // ARRAY TRANSFORM PIPELINE:
  // 1. `.map()` extracts raw string content from text elements
  // 2. `.join('')` concatenates string array elements into one long text string
  // 3. `.trim()` strips extra whitespace
  return paragraph.elements
    .map(function (el) { return (el.textRun && el.textRun.content) || ''; })
    .join('')
    .trim();
}

/**
 * BOLD SELECTION DETECTION HELPER:
 * Evaluates whether a paragraph contains text formatted as BOLD.
 * Iterates through paragraph text runs to check `textStyle.bold === true`.
 */
function paragraphIsBold(paragraph) {
  if (!paragraph || !paragraph.elements) return false;

  // `.some()` checks if AT LEAST ONE element in an array has bold styling applied
  return paragraph.elements.some(function (el) {
    return el.textRun && 
      el.textRun.content && 
      el.textRun.content.trim().length > 0 &&
      el.textRun.textStyle && 
      el.textRun.textStyle.bold === true;
  });
}

/**
 * RECURSIVE TABLE PARSER:
 * Navigates through document elements, entering tables, rows, and cells to collect paragraphs.
 * Restricts recipe title scanning strictly to table cells on the "Table of Recipes" tab.
 */
function collectTableParagraphs(content) {
  let paragraphs = [];
  (content || []).forEach(function (el) {
    if (el.table) {
      el.table.tableRows.forEach(function (row) {
        row.tableCells.forEach(function (cell) {
          (cell.content || []).forEach(function (cellEl) {
            if (cellEl.paragraph) {
              paragraphs.push(cellEl.paragraph);
            }
          });
        });
      });
    }
  });
  return paragraphs;
}

function getSelectedRecipeTitles(tabs) {
  const tocTab = findTabByTitle(tabs, CONFIG.CONTENTS_TAB_TITLE);

  if (!tocTab) throw new Error('Could not find a tab titled "' + CONFIG.CONTENTS_TAB_TITLE + '"');

  // Collect all paragraphs contained inside table cells on the Table of Recipes tab
  const tableParagraphs = collectTableParagraphs(tocTab.documentTab.body.content || []);
  const titles = [];

  tableParagraphs.forEach(function (p) {
    let text = paragraphText(p);

    // Filter out empty lines, non-bold lines, and the exact tab title header line
    if (text && paragraphIsBold(p) && text.toLowerCase() !== CONFIG.CONTENTS_TAB_TITLE.toLowerCase()) {
      titles.push(text);
    }
  });

  return titles;
}

// ------------------------------------------------------------------------------
// RECURSIVE SUB-RECIPE INGREDIENT EXTRACTION
// ------------------------------------------------------------------------------
// Context on Section Parsing:
// Recipes are structured as: TITLE / page break / ingredients / page break / instructions.
// Uses structural breaks (non-paragraph elements) to strictly isolate the ingredients section.
// Ignores parent category tabs (tabs with childTabs) so ingredients containing words like 
// "chicken" or "pork" aren't mistaken for sub-recipes.
function getIngredientsForRecipe(tabs, recipeTitle, visited) { 
  visited = visited || [];

  const targetKey = recipeTitle.trim().toLowerCase();

  // Prevent infinite recursive loops if a sub-recipe references itself
  if (visited.indexOf(targetKey) !== -1) return [];
  visited.push(targetKey);

  const tab = findTabByTitle(tabs, recipeTitle);
  if (!tab) {
    Logger.log('WARNING: no tab found matching title "' + recipeTitle + '" - skipping.');
    return [];
  }

  const content = tab.documentTab.body.content || [];

  // Locate title index
  const titleIdx = content.findIndex(function (el) { return !!el.paragraph; });
  if (titleIdx === -1) return [];

  // First non-paragraph structural element after title = start of ingredients section
  let startBreakIdx = -1;
  for (let i = titleIdx + 1; i < content.length; i++) {
    if (!content[i].paragraph) { startBreakIdx = i; break; }
  }
  if (startBreakIdx === -1) {
    Logger.log('WARNING: no page/section break found after the title in "' + recipeTitle + '" - check formatting.');
    return [];
  } 

  // Next non-paragraph structural element after that = end of ingredients section
  let endBreakIdx = -1; 
  for (let i = startBreakIdx + 1; i < content.length; i++) {
    if (!content[i].paragraph) { endBreakIdx = i; break; }
  }
  if (endBreakIdx === -1) endBreakIdx = content.length;

  let ingredients = [];
  for (let i = startBreakIdx + 1; i < endBreakIdx; i++) {
    const el = content[i];
    if (!el.paragraph) continue;

    // Process bullet point items
    if (el.paragraph.bullet) {
      const text = paragraphText(el.paragraph);
      if (!text) continue;

      // SUB-RECIPE DETECTION:
      // Searches tabs for a sub-recipe match, explicitly ignoring parent category tabs (tabs with childTabs)
      const matchedSubTab = tabs.find(function (t) {
        if (!t.tabProperties || !t.tabProperties.title) return false;

        // SKIP FOLDER CATEGORY TABS: Category tabs holding childTabs are ignored
        if (t.childTabs && t.childTabs.length > 0) return false;

        const subTitle = t.tabProperties.title.trim().toLowerCase();

        // Exclude exact matches to self
        if (subTitle === targetKey) return false;

        return text.toLowerCase().indexOf(subTitle) !== -1;
      });

      if (matchedSubTab) {
        // Sub-recipe match found: recursively fetch ingredients from sub-recipe tab
        const subRecipeTitle = matchedSubTab.tabProperties.title;
        const subIngredients = getIngredientsForRecipe(tabs, subRecipeTitle, visited);
        ingredients = ingredients.concat(subIngredients);
      } else { 
        // Normal ingredient line (e.g., "4 Boneless Skinless Chicken Breasts")
        ingredients.push(text);
      }
    }
  }
  return ingredients;
}

// ------------------------------------------------------------------------------
// SHEET READING HELPERS
// ------------------------------------------------------------------------------
function getSheetColumnAsList(sheetName) {
  const ss = getGrocerySpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return []; // Ok if missing/empty -- just contributes nothing

  // `Math.max(x, y)` returns whichever number is larger (prevents 0 row errors).
  const values = sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), 1).getValues();

  // ARRAY FILTERING PIPELINE:
  return values
    .map(function (row) { return String(row[0]).trim(); })  // Convert cell value to clean text string
    .filter(function (v) { return v.length > 0; });         // Keeps items ONLY if length > 0 (filters out blank rows)
}

// ------------------------------------------------------------------------------
// INGREDIENT GROUPING & COUNTING
// ------------------------------------------------------------------------------
// Context on Data Handling:
// - normalizedItems: recipe/staple ingredients get quantity/unit stripped and merged.
// - verbatimItems: Keep items are kept unaltered (no quantity stripping, no title casing).
//   If an exact match exists in recipes/staples, it merges and receives an isMergedKeep flag.
//   Otherwise, it sits in a separate key namespace ('k:') so it never accidentally merges.
function groupIngredients(normalizedItems, verbatimItems) {
  const map = {}; // key -> { display, count, source, isMergedKeep }

  // Process Recipe and Staple Items
  normalizedItems.forEach(function (raw) {
    const isProtein = isProteinItem(raw);
    
    // Pass isProtein as the second argument (keepQuantity) to normalizeIngredient
    const cleaned = normalizeIngredient(raw, isProtein);
    
    // Grouping key: Strips quantities for protein lookup so variants group together under one key
    const key = isProtein
      ? raw.replace(QUANTITY_UNIT_REGEX, '').trim().toLowerCase()
      : cleaned.toLowerCase();

    if (!map[key]) {
      // Apply Title Case to both protein display lines and standard ingredients
      const display = toTitleCase(cleaned);
      map[key] = { display: display, count: 0, source: 'normalized', isMergedKeep: false };
    } else if (isProtein && map[key].display.toLowerCase().indexOf(cleaned.toLowerCase()) === -1) {
      // Append additional protein measurements if recipes specify different amounts across selected meals
      map[key].display += ' + ' + toTitleCase(cleaned);
    }

    map[key].count++;
  });

  (verbatimItems || []).forEach(function (raw) {
    const trimmed = String(raw).trim();
    if (!trimmed) return;

    const baseKey = trimmed.toLowerCase();

    // Check if an exact match already exists from the recipe/staples list
    if (map[baseKey]) {
      map[baseKey].count++;
      map[baseKey].isMergedKeep = true; // ONLY set true when merged with a recipe/staple
    } else {
      // Standalone Keep Items
      const display = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
      const keepKey = 'k:' + baseKey; // Keep in separate namespace to prevent accidental non-exact merges
      if (!map[keepKey]) {
        map[keepKey] = { display: display, count: 0, source: 'keep', isMergedKeep: false };
      }
      map[keepKey].count++;
    }
  });

  return Object.keys(map)
    .map(function (key) { return map[key]; })
    .sort(function (a, b) { return a.display.localeCompare(b.display); });
}

// ------------------------------------------------------------------------------
// SHEET OUTPUT & FORMULA WRITING
// ------------------------------------------------------------------------------
function deleteExistingTablesOnGrocerySheet() {
  const spreadsheetId = CONFIG.GROCERY_SHEET_ID;

  // Advanced Sheet Service API call to inspect metadata
  const spreadsheet = Sheets.Spreadsheets.get(spreadsheetId);
  const sheetMeta = (spreadsheet.sheets || []).find(function (s) {
    return s.properties.title === CONFIG.OUTPUT_SHEET_NAME;
  });

  if (!sheetMeta || !sheetMeta.tables || sheetMeta.tables.length === 0) return;

  const requests = sheetMeta.tables.map(function (table) {
    return { deleteTable: { tableId: table.tableId } };
  });

  // Send batch update request to Google servers to remove table objects
  Sheets.Spreadsheets.batchUpdate({ requests: requests }, spreadsheetId);
}

function writeToSheet(groupedItems, selectedTitles) {
  const ss = getGrocerySpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.OUTPUT_SHEET_NAME);
  
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.OUTPUT_SHEET_NAME);
  } else {
    deleteExistingTablesOnGrocerySheet(); 
    sheet.clear(); // Clear all data and formatting
  }

  // Row 1: Header display string reflecting selected recipes or indicating staples/keep only
  const headerText = selectedTitles.length > 0 
    ? 'This week\'s recipes: ' + selectedTitles.join('; ')
    : 'This week\'s recipes: None (Staples & Keep Items Only)';
  sheet.getRange(1, 1).setValue(headerText);
  sheet.getRange(1, 1).setFontStyle('italic').setFontColor('#333333');

  // Row 2: Set Column headers in bulk
  sheet.getRange(2, 1, 1, 5).setValues([['', 'Item', 'Quantity', 'Location', 'Staple']]).setFontWeight('bold');

  // Transform grouped item objects into 2D row array for writing
  const rows = groupedItems.map(function (item) {
    let note = '';

    // Quantity display string
    if (item.count > 1) {
      note = item.source === 'keep' ? '(x' + item.count + ')' : '(' + item.count + 'x)';
    }

    // Append ' [K]' flag if a Keep item was merged or included
    if (item.isMergedKeep) {
      note = note ? note + ' [K]' : '[K]';
    }

    return [item.display, note];
  });

  const dataStartRow = 3;
  if (rows.length > 0) {
    // Write names and quantity notes into Columns B and C
    sheet.getRange(dataStartRow, 2, rows.length, 2).setValues(rows);

    // Insert native Interactive Checkboxes into Column A
    sheet.getRange(dataStartRow, 1, rows.length, 1).insertCheckboxes();

    const refSheetName = CONFIG.LOCATION_REFERENCE_SHEET_NAME;
    const locationFormulas = [];

    // Build Google Sheets lookup formulas dynamically for each row
    for (let i = 0; i < rows.length; i++) {
      const r = dataStartRow + i;

      // Constructs standard Excel/Sheets formulas: `=IFERROR(INDEX(... MATCH(...)))`
      const locFormula = '=IFERROR(INDEX(\'' + refSheetName + '\'!$B$18:$B$1000, ' +
       'MATCH(TRUE, ISNUMBER(SEARCH(\'' + refSheetName + '\'!$A$18:$A$1000, B' + r + ')),0)), "")';
      const stapleFormula = '=IFERROR(INDEX(\'' + refSheetName + '\'!$C$18:$C$1000, ' + 
       'MATCH(TRUE, ISNUMBER(SEARCH(\'' + refSheetName + '\'!$A$18:$A$1000, B' + r + ')),0)), "")';

      locationFormulas.push([locFormula, stapleFormula]);
    }

    // Write array of formula strings to sheet (Sheets calculates them automatically)
    sheet.getRange(dataStartRow, 4, rows.length, 2).setValues(locationFormulas);
  }

  // Visual layout configurations
  sheet.setColumnWidth(1, 40);            // Column A width in pixels
  sheet.autoResizeColumns(2, 4);          // Auto-fit widths for Columns B through E
  sheet.setFrozenRows(2);                 // Freeze header rows at top
}

// ------------------------------------------------------------------------------
// ROUTE SHEET GENERATOR & AUTOMATIC SORTING
// ------------------------------------------------------------------------------
function updateRouteSheet() {
  const ss = getGrocerySpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.ROUTE_SHEET_NAME); 
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.ROUTE_SHEET_NAME);
  } else {
    sheet.clear();
  }

  const grocerySheet = ss.getSheetByName(CONFIG.OUTPUT_SHEET_NAME);
  if (!grocerySheet || grocerySheet.getLastRow() < 3) return;

  // Read header string from primary grocery sheet
  const recipeTitleText = grocerySheet.getRange(1, 1).getValue();
  sheet.getRange(1, 1).setValue(recipeTitleText);
  sheet.getRange(1, 1).setFontStyle('italic').setFontColor('#434343').setFontWeight('bold');

  // Row 2: Table title
  sheet.getRange(2, 2).setValue('Shopping Route:');
  sheet.getRange(2, 2).setHorizontalAlignment('center').setFontColor('#333333').setFontWeight('bold');

  sheet.getRange(3, 1, 1, 5).setValues([['', 'Item', 'Qty.', 'Location', 'Staple']]).setHorizontalAlignment('center').setFontWeight('bold');

  // Insert complex array sorting formula into temporary cell
  const formulaCell = sheet.getRange('B4');
  formulaCell.setFormula("=SORT('Grocery List'!B3:E1000, ARRAYFORMULA(IF('Grocery List'!B3:B1000=\"\",3,IF('Grocery List'!E3:E1000=\"Kitchen Staple\",2,1))),true, IFERROR(MATCH('Grocery List'!D3:D1000, 'Custom Order Reference'!A4:A100, 0), 99999), true)");

  // `SpreadsheetApp.flush()` forces Google Sheets to immediately calculate pending formulas
  SpreadsheetApp.flush();

  const lastRow = sheet.getLastRow();
  const maxRows = sheet.getMaxRows();

  if (maxRows >= 4) {
    sheet.getRange(5, 1, maxRows - 3, 1).removeCheckboxes();
  }

  if (lastRow >= 4) {
    const numRows = lastRow - 3;
    const dataRange = sheet.getRange(4, 2, numRows, 4);

    // FREEZE VALUES METHOD: Copies cells over themselves taking values ONLY (strips living formulas)
    dataRange.copyTo(dataRange, {contentsOnly: true});

    sheet.getRange(4, 1, numRows, 1).insertCheckboxes();

    // Store integer ranks in hidden Column F to preserve original sorted route order
    const ranks = [];
    for (let i = 1; i <= numRows; i++) {
      ranks.push([i]);
    }
    sheet.getRange(4, 6, numRows, 1).setValues(ranks);
    sheet.hideColumns(6); // Hide index helper column from view
  }

  sheet.setColumnWidth(1, 40);
  sheet.autoResizeColumns(2, 4);
  sheet.setFrozenRows(3);
} 

// ------------------------------------------------------------------------------
// EVENT TRIGGER: ON EDIT (Moves checked store items to bottom with debounced wait)
// ------------------------------------------------------------------------------
// `onEdit(e)` is an automatic Google Apps Script trigger.
// It fires automatically every single time a user manually edits any cell on the sheet.
// `e` is the Edit Event object containing info on what changed.
function onEdit(e) {
  // Guard Clause: If event object `e` or modified range doesn't exist, stop. 
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();

  // Condition: Only run if edit occurred on 'Route' tab AND in Column 1 (Column A checkboxes)
  if (sheet.getName() !== CONFIG.ROUTE_SHEET_NAME || e.range.getColumn() !== 1) return;

  const lastRow = sheet.getLastRow();
  const dataStartRow = 4; 
  if (lastRow < dataStartRow) return;

  // DEBOUNCE LOGIC (Reset timer on each new click):
  // CacheService allows sharing a lightweight state across parallel execution threads.
  const cache = CacheService.getScriptCache();
  const now = Date.now();
  
  // Record the timestamp of the current edit (minimum CacheService TTL is 20s)
  cache.put('LAST_CHECKBOX_EDIT_TIME', String(now), 20);

  // Poll every 500ms for up to 1.5 seconds (3 iterations * 500ms = 1500ms / 1.5s).
  // If a newer edit occurred, `latestEditTime` will be greater than `now`, causing this thread to exit early.
  for (let i = 0; i < 3; i++) {
    Utilities.sleep(500);
    const latestEditTime = Number(cache.get('LAST_CHECKBOX_EDIT_TIME') || 0);
    if (latestEditTime > now) {
      // A subsequent checkbox was clicked; exit this execution and let the newer thread handle the sort.
      return; 
    }
  }

  // Select all populated data rows
  const range = sheet.getRange(dataStartRow, 1, lastRow - dataStartRow + 1, sheet.getLastColumn());

  // SORT METHOD:
  // Sorts multi-column range dynamically.
  // Primary sort: Column 1 (FALSE/Unchecked on top, TRUE/Checked on bottom).
  // Secondary sort: Column 6 (Hidden index rank keeps store order intact).
  range.sort([
    {column: 1, ascending: true},
    {column: 6, ascending: true}
  ]);
}

/**
 * ------------------------------------------------------------------------------
 * GMAIL KEEP IMPORT FUNCTION
 * ------------------------------------------------------------------------------
 *  Reads unread emails in the "Grocery-Imports" Label, filters out checked items ([X]), 
 *  strips unchecked boxes ([ ]), wipes the old "Keep Items" sheet clean, and writes the new list starting at A1.
 */
function pullKeepFromGmail() {
  // Search Gmail strictly for unread emails in your designated folder
  const threads = GmailApp.search('Label:Grocery-Imports is:unread');
  
  // Stop early if there are no new emails to process
  if (threads.length === 0) return 0;

  const newItems = [];

  // Loop through every unread email thread found
  threads.forEach(function(thread) { 
    const messages = thread.getMessages();

    messages.forEach(function(msg) { 
      // Split email body into individual text lines
      const lines = msg.getPlainBody().split(/\r?\n/);

      lines.forEach(function(line) {
        let cleaned = line.trim();

        // 1. SKIP CHECKED ITEMS: If line starts with [X], or [x], ignore it completely
        if (/^\[x\]/i.test(cleaned)) return;

        // 2. STRIP UNCHECKED BOXES & BULLETS: Remove [ ], [  ], bullets (•, -, *), or leading spaces
        cleaned = cleaned.replace(/^(?:\[\s*\]|[•\*\s\-])+/i, '').trim();

        // 3. FILTER OUT FOOTERS/BLANKS: Skip blank lines, email dividers, or signatures
        if (cleaned && !cleaned.startsWith('--') && !cleaned.includes('Sent from my')) {
          newItems.push(toTitleCase(cleaned));
        }
      });
    });

    // Mark thread as Read so it is ignored on all future runs
    thread.markRead();
  });

  // If new items were found, wipe the old Keep Items sheet and write the new list 
  if (newItems.length > 0) {
    const ss = getGrocerySpreadsheet();
    let sheet = ss.getSheetByName(CONFIG.KEEP_SHEET_NAME);

    if (!sheet) { 
      sheet = ss.insertSheet(CONFIG.KEEP_SHEET_NAME);
    } else {
      // Wipe last week's entries completely before adding new ones
      sheet.clearContents();
    }

    // Convert array into 2D format required by Google Sheets [[Row1], [Row2]]
    const values = newItems.map(function(item) { return [item]; });

    // Write fresh items starting at Cell A1
    sheet.getRange(1, 1, newItems.length, 1).setValues(values);
  }

  return newItems.length;
}
