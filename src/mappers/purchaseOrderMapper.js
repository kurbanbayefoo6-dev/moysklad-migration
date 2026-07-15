import {
	copyScalarFields,
	getRows,
	isObject,
	mapAssortmentPosition,
	mapCommonDocumentReferences,
	purchaseOrderAttributeResolver,
	purchaseOrderStateResolver,
	removeUndefined,
} from './purchaseChainMapperUtils.js'

const SCALAR_FIELDS = [
	'name',
	'moment',
	'applicable',
	'description',
	'externalCode',
	'vatEnabled',
	'vatIncluded',
	'deliveryPlannedMoment',
]

export class PurchaseOrderMapper {
	async map(purchaseOrder) {
		if (!isObject(purchaseOrder)) {
			throw new Error('Purchase Order payload is required')
		}

		const payload = {}
		copyScalarFields(payload, purchaseOrder, SCALAR_FIELDS)
		await mapCommonDocumentReferences(payload, purchaseOrder, {
			stateResolver: purchaseOrderStateResolver,
			attributeResolver: purchaseOrderAttributeResolver,
			requireStore: true,
			documentType: 'purchaseorder',
		})

		payload.positions = await Promise.all(
			getRows(purchaseOrder.positions).map(position =>
				mapAssortmentPosition(position, purchaseOrder),
			),
		)

		return removeUndefined(payload) || {}
	}
}

export const purchaseOrderMapper = new PurchaseOrderMapper()

export default purchaseOrderMapper
