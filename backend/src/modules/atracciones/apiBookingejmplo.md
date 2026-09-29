# Attractions quick guide Beta

**Enable travellers to find, compare, and view attractions with key details such as name, description, and pricing.**.

This quick guide shows the minimum steps needed to integrate the [Demand API attractions endpoints](/demand/docs/open-api/3.2-beta/demand-api/attractions).

div
strong
⏱️ Estimated time to complete:
15 - 30 minutes 
br
br
ul
li
strong
Purpose:
Fast setup to search for attractions and retrieve their details.
li
strong
When to use:
You’re new to the Attractions API and want to try a simple example.
li
strong
You´ll learn how to:
ol
li
Search for available attractions.
li
Retrieve attraction details.
li
Redirect to the Booking.com attraction page to book.
li
strong
Code samples:
Minimal, using only the required fields.
## Before you start

Before testing the endpoints, make sure you **have been granted access to this Beta-pilot programme** (Contact your Account Manager)

You’ll need:

✓ A [valid API key token](/demand/docs/development-guide/authentication/#api-key-management).
✓ Your `X-Affiliate-Id`
✓ Open the [try out console](/demand/docs/getting-started/try-out-the-api#try-out-console).

## Steps

### 1. Search for attractions

→ Use the attractions/search endpoint to attractions available in your selected area and dates.

> **Use case:** *A traveller searches for popular attractions in Amsterdam between 18–20 December 2025.*


**Example request per country:**

```json
{
  "currency": "EUR", // This is mandatory
  "cities": [-2140479],
  "countries": ["nl"],
  "dates": {
    "start_date": "2025-12-18",
    "end_date": "2025-12-20"
  },
  "filters": {
    "rating": {
      "minimum_review_score": 4.2,
      "minimum_review_count": 100
    },
  },
  "rows": 20,
  "sort": {
    "by": "most_popular"
  }
}
```

* `countries` and `cities` are location IDs (get these from [/locations/countries](/demand/docs/open-api/demand-api/commonlocations/common/locations/countries) and [/locations/cities](/demand/docs/open-api/demand-api/commonlocations/common/locations/cities) endpoints). Always use ISO 3166-1 alpha-2 lowercase.
* See the [Data conventions guide](/demand/docs/development-guide/code-conventions) for date/times formats.


**Example response:**

```json
{
  "data": [
    {
      "id": "PRahAzWtTraa",
      "free_cancellation": true,
      "price": {
        "currency": "EUR",
        "total": 20
      },
      "url": {
        "web": "https://www.booking.com/attractions/nl/prahazwttraa-heineken-experience-amsterdam.en-gb.html"
      }
    },
    {
      "id": "PRAmdacCwQLH",
      "free_cancellation": false,
      "price": {
        "currency": "EUR",
        "total": 15.5
      },
      "url": {
        "web": "https://www.booking.com/attractions/nl/pramdaccwqlh-madame-tussauds-ticket.en-gb.html"
      }
    }
  ],
  "metadata": {
    "total_results": 128
  },
  "request_id": "01fr9ez700exycb98w90w5r9sh"
}
```

The response includes:

* A list of atractions.
* Whether free cancellation is available.
* Pricing information (in the requested currency)
* A URL to the Booking.com attractions page.


Keep the attraction `id` (for example, PRahAzWtTraa) for the next step.

→ Try it yourself!

### 2. Retrieve attraction details

→ Use the [/attractions/details](/demand/docs/open-api/3.2-beta/demand-api/attractions/attractions/details) endpoint to get static details about specific attractions (in this case, PRahAzWtTraa) — including name, description, location, categories, photos, and ratings.

**Example request:**

```json
{
  "attractions": ["PRahAzWtTraa"],
  "languages": ["en-gb"]
}
```

→ [Try it yourself](/demand/docs/open-api/3.2-beta/demand-api/attractions/attractions/details)

If you request multiple languages, the API will return data in your preferred language when available; otherwise, English is returned by default.

**Example response:**

The response contains all the information about the selected attraction including contact information, name, score/reviews, etc.

```json
{
  "request_id": "01fr9ez700exycb98w90w5r9sh",
  "data": [
    {
      "id": "PRahAzWtTraa",
      "name": "Heineken Experience Amsterdam",
      "categories": ["food_drinks"],
      "duration": "PT2H",
      "badges": ["best_seller"],
      "photos": [
        {
          "url": "https://cf.bstatic.com/xdata/images/xphoto/500x375/170335205.jpg"
        }
      ],
      "locations": [
        {
          "address": "Stadhouderskade 78",
          "city": -2140479,
          "country": "nl",
          "coordinates": {
            "latitude": 52.360043,
            "longitude": 4.885177
          },
          "type": "attraction"
        }
      ],
      "long_description": "Discover the history of Heineken and enjoy a behind-the-scenes interactive experience in Amsterdam’s original brewery.",
      "ratings": {
        "number_of_reviews": 3250,
        "score": 4.8
      },
      "supported_languages": ["en-gb", "nl"],
      "url": {
        "web": "https://www.booking.com/attractions/nl/prahazwttraa-heineken-experience-amsterdam.en-gb.html"
      }
    }
  ]
}
```

The response provides static content such as:

* Attraction name and description.
* Duration and categories.
* Location details (address, coordinates, city).
* Photos and supported languages.
* Rating data.


See the [Attraction details guide](/demand/docs/attractions/retrieve-attraction-details) for recommendations on displaying and storing static data.

### 3. Redirect to Booking.com

Each attraction response includes a direct `url` (web and app) that you can use to redirect travellers to Booking.com to complete their booking.

Example:

```json
"url": {
  "app": "booking://attractions/product?slug=prahazwttraa-heineken-experience-amsterdam&aid=956509",
  "web": "https://www.booking.com/attractions/nl/prahazwttraa-heineken-experience-amsterdam.en-gb.html?selected_currency=EUR&aid=956509"
}
```

Use the `aid` parameter (your affiliate ID) to ensure proper attribution.

### 4. Retrieve next page results

If your initial /attractions/search response includes a `metadata.next_page` token, use it to fetch the next set of results.

```json
{
  "next_page": "eyJwYWdlIjoyfQ=="
}
```

Each subsequent call returns:

* The next rows of results.
* An updated `next_page` token (if more results are available)
* Repeat until the `next_page` field is no longer returned.


For optimal performance, store the last `next_page` token and use it to resume pagination if a session is interrupted. See the [Pagination guide](/demand/docs/development-guide/pagination) for more details.

### Summary

| Step | Endpoint | Purpose |
|  --- | --- | --- |
| 1 | `/attractions/search` | Search for available attractions and prices |
| 2 | `/attractions/details` | Retrieve static details about selected attractions |
| 3 | — | Redirect users to Booking.com using the attraction URL |
| 4 | `/attractions/search` | Retrieve next page of search results using `metadata.next_page` |


## Best practices

* Always include your API key token and `X-Affiliate-Id` in every request.
* Use the correct [data conventions](/demand/docs/development-guide/code-conventions) in your requests to avoid errors.
* [Store static location data](/demand/docs/attractions/retrieve-attraction-details#best-practice---store-attraction-details) (cities, countries, etc) to reduce API calls.


## Troubleshooting

Here are some common issues you might encounter when testing the Attractions endpoints.

### Missing or invalid required fields

If a required field such as `currency` or `cities` is missing or invalid, the API returns a 400 Bad Request error.

Example response:

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "The 'currency' field is required."
  },
  "request_id": "01hrp9d99wz7dwh1z7nv67j5c9"
}
```

✅ Fix: Include the missing parameter.

### Invalid pagination token

If you send an expired or malformed next_page value, the API returns a 400 Bad Request error.

Example response:

```json
{
  "error": {
    "code": "INVALID_NEXT_PAGE",
    "message": "The provided next_page token is invalid or expired."
  },
  "request_id": "01hrp9db6bn49sp8stnt8kr09q"
}
```

✅ Fix: Restart the search without a next_page token to generate a fresh pagination sequence.

### No results found

If your filters are too restrictive or the location has no matching attractions, you’ll receive an empty data array.

Example response:

```json
{
  "data": [],
  "metadata": {
    "total_results": 0
  },
  "request_id": "01hrp9f89gzfwdw5bt4x40wrta"
}
```

✅ Fix: Broaden your filters (for example, reduce minimum_review_score or remove supported_languages).

#### Still not working?

If the issue persists:

* Check your X-Affiliate-Id and authentication header.
* Review the [Client error codes and examples](/demand/docs/support/error-handling/error-codes).
* Ensure your request body is valid JSON and uses UTF-8 encoding.
* Use the Try-out console to test your payload interactively.


## Next steps

Congratulations, by now you know the basics of how to use the key attractions endpoints for the Search, look and redirect flow!

- Explore the [Search for attractions guide](/demand/docs/attractions/search-attractions) and [use cases](/demand/docs/attractions/search-attractions-examples) for more examples.
- Learn how to [Display and Store Attraction details](/demand/docs/attractions/display-attraction-details).
- See tha [Attractions API reference here](/demand/docs/open-api/3.2-beta/demand-api/attractions) for all endpoints and schemas.