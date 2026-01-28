const apiKey = Deno.env.get("BRIGHTDATA_API_KEY");
const url = "https://api.brightdata.com/datasets/v3/scrape?dataset_id=gd_m7aof0k82r803d5bjm&include_errors=true";

const response = await fetch(url, {
    method: "POST",
    headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
    },
    body: JSON.stringify({
        custom_output_fields: "url|prompt|answer_text_markdown|citations|links_attached|search_sources|model|web_search_query",
        input: [{
            url: "http://chatgpt.com/",
            prompt: "mejor academia de inglés para niños en Alcúdia",
            web_search: true,
            country: "ES"
        }]
    })
});

console.log("Status:", response.status);
const text = await response.text();
console.log("Raw response (first 5000 chars):");
console.log(text.substring(0, 5000));
