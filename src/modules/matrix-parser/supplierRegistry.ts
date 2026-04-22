import { getApgeRequirements, isApgeMatrix, parseApgeSilo } from './apge/apgeParser'
import {
  extractAeTexasEffectiveDate,
  getAeTexasRequirements,
  isAeTexasMatrix,
  parseAeTexasSilo,
} from './ae-texas/ae-texas-parser'
import { getEngieRequirements, isEngieMatrix, parseEngieSilo } from './engie/engieParser'
import {
  extractNrgEffectiveDate,
  getNrgRequirements,
  isNrgMatrix,
  parseNrgSilo,
} from './nrg/nrgParser'
// import {
//   extractSfeEffectiveDate,
//   getSfeRequirements,
//   isSfeMatrix,
//   parseSfeSilo,
// } from './sfe/sfe-parser'
import {
  getNexteraRequirements,
  isNexteraMatrix,
  parseNexteraSilo,
} from './nextera/nexteraParser'
import { getSparkRequirements, isSparkMatrix, parseSparkSilo } from './spark/sparkParser'
import {
  getChariotRequirements,
  isChariotMatrix,
  parseChariotSilo,
} from '../../logic/parsers/chariot-energy-parser'
import {
  APGE_MATRIX_FILENAME_KEYWORDS,
  AE_TEXAS_MATRIX_FILENAME_KEYWORDS,
  CHARIOT_FILENAME_KEYWORDS,
  ENGIE_MATRIX_FILENAME_KEYWORDS,
  NRG_MATRIX_FILENAME_KEYWORDS,
  NEXTERA_MATRIX_FILENAME_KEYWORDS,
  SPARK_MATRIX_FILENAME_KEYWORDS,
} from './supplierFilenameKeywords'
import type { Rate } from '../../types/market-data'

export {
  APGE_MATRIX_FILENAME_KEYWORDS,
  AE_TEXAS_MATRIX_FILENAME_KEYWORDS,
  CHARIOT_FILENAME_KEYWORDS,
  ENGIE_MATRIX_FILENAME_KEYWORDS,
  NRG_MATRIX_FILENAME_KEYWORDS,
  NEXTERA_MATRIX_FILENAME_KEYWORDS,
  SFE_MATRIX_FILENAME_KEYWORDS,
  SPARK_MATRIX_FILENAME_KEYWORDS,
} from './supplierFilenameKeywords'

export interface SupplierSilo {
  readonly id: string
  readonly name: string
  readonly keywords: readonly string[]
  readonly identify: (
    sheetNames: readonly string[],
    fileName?: string,
    firstSheetRows?: unknown[][],
    sheetPreviews?: Readonly<Record<string, unknown[][]>>,
  ) => boolean
  readonly getReqs: () => { readonly targetSheets: readonly string[] }
  readonly extractEffectiveDate?: (
    sheets: Readonly<Record<string, unknown[][]>>,
    fileName?: string,
  ) => string | null
  readonly parse: (
    sheets: Record<string, unknown[][]>,
    fileName: string,
    effectiveDate: string,
  ) => Rate[]
}

export const SUPPLIER_REGISTRY: readonly SupplierSilo[] = [
  {
    id: 'ae-texas',
    name: 'Atlantic Energy (AETexas)',
    keywords: AE_TEXAS_MATRIX_FILENAME_KEYWORDS,
    identify: isAeTexasMatrix,
    getReqs: getAeTexasRequirements,
    extractEffectiveDate: extractAeTexasEffectiveDate,
    parse: parseAeTexasSilo, // Ensure this matches the export in ae-texas-parser.ts
  },
  {
    id: 'nrg',
    name: 'NRG',
    keywords: NRG_MATRIX_FILENAME_KEYWORDS,
    identify: isNrgMatrix,
    getReqs: getNrgRequirements,
    extractEffectiveDate: extractNrgEffectiveDate,
    parse: parseNrgSilo,
  },
  {
    id: 'engie',
    name: 'ENGIE',
    keywords: ENGIE_MATRIX_FILENAME_KEYWORDS,
    identify: isEngieMatrix,
    getReqs: getEngieRequirements,
    parse: parseEngieSilo,
  },
  {
    id: 'apge',
    name: 'APG&E',
    keywords: APGE_MATRIX_FILENAME_KEYWORDS,
    identify: isApgeMatrix,
    getReqs: getApgeRequirements,
    parse: parseApgeSilo,
  },
  {
    id: 'nextera',
    name: 'NextEra',
    keywords: NEXTERA_MATRIX_FILENAME_KEYWORDS,
    identify: isNexteraMatrix,
    getReqs: getNexteraRequirements,
    parse: (sheets, _fileName, effectiveDate) => parseNexteraSilo(sheets, effectiveDate),
  },
  {
    id: 'spark',
    name: 'Spark Energy',
    keywords: SPARK_MATRIX_FILENAME_KEYWORDS,
    identify: isSparkMatrix,
    getReqs: getSparkRequirements,
    parse: parseSparkSilo,
  },
  {
    id: 'chariot',
    name: 'Chariot Energy',
    keywords: CHARIOT_FILENAME_KEYWORDS,
    identify: isChariotMatrix,
    getReqs: getChariotRequirements,
    parse: parseChariotSilo,
  },
  // {
  //   id: 'sfe',
  //   name: 'SFE',
  //   keywords: SFE_MATRIX_FILENAME_KEYWORDS,
  //   identify: isSfeMatrix,
  //   getReqs: getSfeRequirements,
  //   extractEffectiveDate: extractSfeEffectiveDate,
  //   parse: parseSfeSilo,
  // },
] as const
