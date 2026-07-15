const TEMPORARY_STATUSES = new Set([408, 429, 500, 502, 503, 504])
const DEFAULT_MAX_RETRIES = 5
const DEFAULT_DELAY_MS = 1000

function delay(ms) {
	return new Promise(resolve => {
		setTimeout(resolve, ms)
	})
}

function isTemporaryError(error) {
	if (!error?.status) {
		return true
	}

	return TEMPORARY_STATUSES.has(error.status)
}

export async function withApiRetries(
	action,
	label,
	{ maxRetries = DEFAULT_MAX_RETRIES, delayMs = DEFAULT_DELAY_MS } = {},
) {
	let lastError

	for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
		try {
			return await action()
		} catch (error) {
			lastError = error
			if (!isTemporaryError(error) || attempt === maxRetries) {
				throw error
			}

			console.log(
				`Temporary API error during ${label}. Retry ${attempt}/${maxRetries - 1}`,
			)
			await delay(delayMs * attempt)
		}
	}

	throw lastError
}

export default withApiRetries
