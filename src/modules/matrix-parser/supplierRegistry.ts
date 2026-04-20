import { getApgeRequirements, isApgeMatrix, parseApgeSilo } from './apge/apgeParser'
import { getEngieRequirements, isEngieMatrix, parseEngieSilo } from './engie/engieParser'
import {
  extractNrgEffectiveDate,
  getNrgRequirements,
  isNrgMatrix,
  parseNrgSilo,
} from './nrg/nrgParser'
import {
  getNexteraRequirements,
  isNexteraMatrix,
  parseNexteraSilo,
} from './nextera/nexteraParser'
import type { Rate } from '../../types/market-data'

export interface SupplierSilo {
  readonly id: string
  readonly name: string
  readonly identify: (sheetNames: readonly string[], fileName?: string) => boolean
  readonly getReqs: () => { readonly targetSheets: readonly string[] }
  readonly extractEffectiveDate?: (sheets: Readonly<Record<string, unknown[][]>>) => string | null
  readonly parse: (
    sheets: Record<string, unknown[][]>,
    fileName: string,
    effectiveDate: string,
  ) => Rate[]
}

export const SUPPLIER_REGISTRY: readonly SupplierSilo[] = [
  {
    id: 'nrg',
    name: 'NRG',
    identify: isNrgMatrix,
    getReqs: getNrgRequirements,
    extractEffectiveDate: extractNrgEffectiveDate,
    parse: parseNrgSilo,
  },
  {
    id: 'engie',
    name: 'ENGIE',
    identify: isEngieMatrix,
    getReqs: getEngieRequirements,
    parse: parseEngieSilo,
  },
  {
    id: 'apge',
    name: 'APG&E',
    identify: isApgeMatrix,
    getReqs: getApgeRequirements,
    parse: parseApgeSilo,
  },
  {
    id: 'nextera',
    name: 'NextEra',
    identify: isNexteraMatrix,
    getReqs: getNexteraRequirements,
    parse: (sheets, _fileName, effectiveDate) => parseNexteraSilo(sheets, effectiveDate),
  },
] as const
