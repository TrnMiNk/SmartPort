package smartport_m1m.m1.controller;

import static org.junit.jupiter.api.Assertions.*;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class VoyageHttpIntegrationTest {
    private static final String INTEGRATION = "/api/v1/integration/voyages";
    private static final String API_KEY = UUID.randomUUID().toString();
    private static final String IDEM_KEY = UUID.randomUUID().toString();
    private static final String PARTNER_BODY = """
            {"vesselImo":"9074729","voyageNo":"HTTP-TEST","originPortCode":"TEST",
             "declaredEta":"2026-11-20T10:00:00Z","cargoType":"container","declaredTeu":10}
            """;
    private static final String VOYAGE_BODY = """
            {"vesselId":3,"voyageNo":"HTTP-TEST","agentId":9,"originPortId":4,
             "declaredEta":"2026-11-20T10:00:00Z","cargoType":"container","declaredTeu":10}
            """;
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final HttpClient HTTP = HttpClient.newHttpClient();
    private static final BlockingQueue<ForwardedRequest> REQUESTS = new LinkedBlockingQueue<>();
    private static final AtomicReference<StubResponse> RESPONSE = new AtomicReference<>();
    private static final HttpServer UPSTREAM = startUpstream();

    @Autowired private WebServerApplicationContext context;

    private record StubResponse(int status, String body, boolean disconnect) {}
    private record ForwardedRequest(String method, String path, String apiKey, String idem, String body, String operatorKey, String query) {}

    private static HttpServer startUpstream() {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/", exchange -> {
                REQUESTS.add(new ForwardedRequest(exchange.getRequestMethod(), exchange.getRequestURI().getPath(),
                        exchange.getRequestHeaders().getFirst("X-API-Key"),
                        exchange.getRequestHeaders().getFirst("Idempotency-Key"),
                        new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8),
                        exchange.getRequestHeaders().getFirst("X-UC015-Key"), exchange.getRequestURI().getRawQuery()));
                try {
                    StubResponse response = RESPONSE.get();
                    if (response.disconnect()) return;
                    byte[] bytes = response.body().getBytes(StandardCharsets.UTF_8);
                    exchange.getResponseHeaders().set("Content-Type", "application/json");
                    exchange.sendResponseHeaders(response.status(), bytes.length);
                    exchange.getResponseBody().write(bytes);
                } finally {
                    exchange.close();
                }
            });
            server.start();
            return server;
        } catch (IOException exception) {
            throw new IllegalStateException("Unable to start local upstream stub", exception);
        }
    }

    @DynamicPropertySource
    static void upstreamUrl(DynamicPropertyRegistry registry) {
        registry.add("smartport.node-api.base-url", () -> "http://127.0.0.1:" + UPSTREAM.getAddress().getPort());
    }

    @BeforeEach
    void reset() {
        REQUESTS.clear();
        RESPONSE.set(new StubResponse(500, "{}", false));
    }

    @AfterAll
    static void stopUpstream() {
        UPSTREAM.stop(0);
        HTTP.close();
    }

    private HttpRequest.Builder request(String path) {
        return HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + context.getWebServer().getPort() + path))
                .timeout(Duration.ofSeconds(5));
    }

    private HttpResponse<String> post(String path, String body, boolean apiKey, boolean idem) throws Exception {
        var builder = request(path).header("Content-Type", "application/json");
        if (apiKey) builder.header("X-API-Key", API_KEY);
        if (idem) builder.header("Idempotency-Key", IDEM_KEY);
        return HTTP.send(builder.POST(HttpRequest.BodyPublishers.ofString(body)).build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private void assertJson(HttpResponse<String> response, int status, String expected) {
        assertEquals(status, response.statusCode());
        assertTrue(response.headers().firstValue("Content-Type").orElse("").startsWith("application/json"));
        assertEquals(JSON.readTree(expected), JSON.readTree(response.body()));
    }

    private void assertForwarded(String path, String body, boolean apiKey) throws Exception {
        var forwarded = REQUESTS.poll(2, TimeUnit.SECONDS);
        assertNotNull(forwarded);
        assertEquals("POST", forwarded.method());
        assertEquals(path, forwarded.path());
        assertEquals(apiKey ? API_KEY : null, forwarded.apiKey());
        assertEquals(IDEM_KEY, forwarded.idem());
        // Optional fields may be serialized as null by Spring.
        var expected = JSON.readTree(body);
        var actual = JSON.readTree(forwarded.body());
        expected.properties().forEach(entry -> assertEquals(entry.getValue(), actual.get(entry.getKey())));
    }

    @ParameterizedTest
    @ValueSource(ints = {201, 200})
    void integrationPreservesCreateAndReplayJsonAndForwardsBothHeaders(int status) throws Exception {
        String payload = "{\"success\":true,\"referenceId\":41,\"status\":\"ANNOUNCED\",\"missingFields\":[]"
                + (status == 200 ? ",\"replayed\":true}" : "}");
        RESPONSE.set(new StubResponse(status, payload, false));
        assertJson(post(INTEGRATION, PARTNER_BODY, true, true), status, payload);
        assertForwarded(INTEGRATION, PARTNER_BODY, true);
    }

    @ParameterizedTest
    @ValueSource(ints = {400, 401, 403, 404, 409, 422})
    void integrationPreservesEveryBusinessErrorStatusAndJson(int status) throws Exception {
        String payload = "{\"success\":false,\"code\":\"ERROR_" + status
                + "\",\"referenceId\":41,\"errors\":[\"field error\"]}";
        RESPONSE.set(new StubResponse(status, payload, false));
        assertJson(post(INTEGRATION, PARTNER_BODY, true, true), status, payload);
        assertForwarded(INTEGRATION, PARTNER_BODY, true);
    }

    @ParameterizedTest
    @ValueSource(ints = {500, 502, 503, 418, 429})
    void integrationMapsUnexpectedUpstreamErrorsTo502(int status) throws Exception {
        RESPONSE.set(new StubResponse(status, "{\"internal\":\"upstream detail\"}", false));
        var response = post(INTEGRATION, PARTNER_BODY, true, true);
        assertEquals(502, response.statusCode());
        assertEquals(502, JSON.readTree(response.body()).get("status").asInt());
        assertFalse(response.body().contains("upstream detail"));
        assertForwarded(INTEGRATION, PARTNER_BODY, true);
    }

    @ParameterizedTest
    @ValueSource(strings = {"{", "null"})
    void integrationMapsInvalidUpstreamJsonTo502(String payload) throws Exception {
        RESPONSE.set(new StubResponse(200, payload, false));
        assertEquals(502, post(INTEGRATION, PARTNER_BODY, true, true).statusCode());
        assertForwarded(INTEGRATION, PARTNER_BODY, true);
    }

    @Test
    void integrationMapsBrokenUpstreamConnectionTo502() throws Exception {
        RESPONSE.set(new StubResponse(200, "", true));
        assertEquals(502, post(INTEGRATION, PARTNER_BODY, true, true).statusCode());
    }

    @Test
    void missingHeadersAreRejectedBeforeCallingUpstream() throws Exception {
        assertEquals(401, post(INTEGRATION, PARTNER_BODY, false, true).statusCode());
        assertEquals(400, post(INTEGRATION, PARTNER_BODY, true, false).statusCode());
        assertTrue(REQUESTS.isEmpty());
    }

    @Test
    void impossibleDateIsRejectedBeforeCallingUpstream() throws Exception {
        assertEquals(400, post(INTEGRATION,
                PARTNER_BODY.replace("2026-11-20", "2026-02-30"), true, true).statusCode());
        assertTrue(REQUESTS.isEmpty());
    }

    @ParameterizedTest
    @ValueSource(ints = {400, 404, 409, 422})
    void uc013StillPreservesBusinessErrorStatusAndJson(int status) throws Exception {
        String payload = "{\"success\":false,\"code\":\"UC013_ERROR\",\"existingVoyageId\":41}";
        RESPONSE.set(new StubResponse(status, payload, false));
        assertJson(post("/api/v1/voyages", VOYAGE_BODY, false, true), status, payload);
        assertForwarded("/api/voyages", VOYAGE_BODY, false);
    }

    @ParameterizedTest
    @ValueSource(ints = {201, 200})
    void uc013StillCreatesAndReplays(int status) throws Exception {
        String payload = "{\"success\":true,\"data\":{\"id\":41}"
                + (status == 200 ? ",\"replayed\":true}" : "}");
        RESPONSE.set(new StubResponse(status, payload, false));
        assertJson(post("/api/v1/voyages", VOYAGE_BODY, false, true), status, payload);
        assertForwarded("/api/voyages", VOYAGE_BODY, false);
    }

    @Test
    void uc013GetStillPreserves404AndMapsUpstreamFailureTo502() throws Exception {
        for (int status : new int[] {404, 500}) {
            String payload = "{\"success\":false,\"code\":\"VOYAGE_NOT_FOUND\"}";
            RESPONSE.set(new StubResponse(status, payload, false));
            var response = HTTP.send(request("/api/v1/voyages/41").GET().build(), HttpResponse.BodyHandlers.ofString());
            if (status == 404) assertJson(response, 404, payload);
            else assertEquals(502, response.statusCode());
        }
    }

    @Test
    void uc012FilenameWithoutExtensionReturns400WithoutCallingNode() throws Exception {
        String multipart = "--boundary\r\nContent-Disposition: form-data; name=\"document_type\"\r\n\r\nRegistry\r\n"
                + "--boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"nodot\"\r\n"
                + "Content-Type: application/pdf\r\n\r\n%PDF-1.7\r\n--boundary--\r\n";
        var response = HTTP.send(request("/api/v1/vessels/3/documents")
                .header("Content-Type", "multipart/form-data; boundary=boundary")
                .POST(HttpRequest.BodyPublishers.ofString(multipart)).build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(400, response.statusCode());
        assertEquals(400, JSON.readTree(response.body()).get("status").asInt());
        assertTrue(REQUESTS.isEmpty());
    }

    private HttpResponse<String> uc015(boolean queue, String key) throws Exception {
        var builder = request(queue ? "/api/v1/voyages/queue" : "/api/v1/voyages/41/validate");
        if (key != null) builder.header("X-UC015-Key", key);
        return HTTP.send((queue ? builder.GET() : builder.POST(HttpRequest.BodyPublishers.noBody())).build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private void assertUc015Forwarded(boolean queue) throws Exception {
        var forwarded = REQUESTS.poll(2, TimeUnit.SECONDS);
        assertNotNull(forwarded);
        assertEquals(queue ? "GET" : "POST", forwarded.method());
        assertEquals(queue ? "/api/voyages/queue" : "/api/voyages/41/validate", forwarded.path());
        assertEquals(API_KEY, forwarded.operatorKey());
        assertNull(forwarded.apiKey());
        assertEquals("", forwarded.body());
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void uc015ForwardsPathsKeyAndSuccessJson(boolean queue) throws Exception {
        String row = "{\"validationResult\":\"VALID\",\"validationReason\":null,\"status\":\"QUEUED\","
                + "\"queuePosition\":1,\"predictedEta\":null,\"aiStatus\":\"UNAVAILABLE\"}";
        String payload = queue ? "{\"success\":true,\"data\":[" + row + "]}" : row;
        RESPONSE.set(new StubResponse(200, payload, false));
        assertJson(uc015(queue, API_KEY), 200, payload);
        assertUc015Forwarded(queue);
    }

    @ParameterizedTest
    @ValueSource(ints = {400, 401, 403, 404, 409, 422, 503})
    void uc015PreservesBusinessAndUnavailableStatusAndJson(int status) throws Exception {
        String payload = status == 422
                ? "{\"validationResult\":\"MISSING_DOCUMENTS\",\"validationReason\":\"DOCUMENTS_NOT_ELIGIBLE: Registry\","
                  + "\"status\":\"ANNOUNCED\",\"queuePosition\":null,\"predictedEta\":null,\"aiStatus\":\"UNAVAILABLE\"}"
                : "{\"success\":false,\"code\":\"ERROR_" + status + "\"}";
        RESPONSE.set(new StubResponse(status, payload, false));
        for (boolean queue : new boolean[] {false, true}) {
            assertJson(uc015(queue, API_KEY), status, payload);
            assertUc015Forwarded(queue);
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"{", "null", "[]"})
    void uc015MapsInvalidSuccessJsonTo502(String payload) throws Exception {
        RESPONSE.set(new StubResponse(200, payload, false));
        assertEquals(502, uc015(false, API_KEY).statusCode());
        assertUc015Forwarded(false);
    }

    @Test
    void uc015MapsDatabaseErrorAndBrokenConnectionTo502() throws Exception {
        RESPONSE.set(new StubResponse(500, "{\"internal\":\"private database details\"}", false));
        var response = uc015(false, API_KEY);
        assertEquals(502, response.statusCode());
        assertFalse(response.body().contains("private database details"));
        RESPONSE.set(new StubResponse(200, "", true));
        assertEquals(502, uc015(true, API_KEY).statusCode());
    }

    @Test
    void uc015RejectsMissingKeyAndBadIdBeforeUpstream() throws Exception {
        assertEquals(401, uc015(false, null).statusCode());
        assertEquals(401, uc015(true, null).statusCode());
        var response = HTTP.send(request("/api/v1/voyages/0/validate").header("X-UC015-Key", API_KEY)
                .POST(HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(400, response.statusCode());
        assertTrue(REQUESTS.isEmpty());
    }

    private HttpResponse<String> uc016(boolean history, String key) throws Exception {
        var builder = request("/api/v1/voyages/41/" + (history ? "eta-predictions?beforeId=9007199254740993" : "eta-prediction"));
        if (key != null) builder.header("X-UC015-Key", key);
        return HTTP.send((history ? builder.GET() : builder.POST(HttpRequest.BodyPublishers.noBody())).build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private void assertUc016Forwarded(boolean history) throws Exception {
        var forwarded = REQUESTS.poll(2, TimeUnit.SECONDS);
        assertNotNull(forwarded);
        assertEquals(history ? "GET" : "POST", forwarded.method());
        assertEquals("/api/voyages/41/" + (history ? "eta-predictions" : "eta-prediction"), forwarded.path());
        assertEquals(history ? "beforeId=9007199254740993" : null, forwarded.query());
        assertEquals(API_KEY, forwarded.operatorKey());
        assertNull(forwarded.apiKey());
        assertEquals("", forwarded.body());
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void uc016ForwardsPathsKeyCursorAndPredictionJson(boolean history) throws Exception {
        String row = """
                {"voyageId":41,"declaredEta":"2026-11-20T10:00:00Z","predictedEta":"2026-11-20T09:30:00Z",
                 "etaDeviationH":-0.5,"etaConfidence":0.8,"aiStatus":"AVAILABLE","modelVersion":"http-test-fixture-v1",
                 "effectiveEta":"2026-11-20T09:30:00Z","predictedAt":"2026-11-19T00:00:00Z"}
                """;
        String payload = history ? "{\"success\":true,\"data\":[" + row + "],\"nextBeforeId\":null}" : row;
        RESPONSE.set(new StubResponse(200, payload, false));
        assertJson(uc016(history, API_KEY), 200, payload);
        assertUc016Forwarded(history);
    }

    @ParameterizedTest
    @ValueSource(ints = {400, 401, 403, 404, 409, 422, 503})
    void uc016PreservesEveryExpectedHttpErrorAndJson(int status) throws Exception {
        String payload = "{\"success\":false,\"code\":\"ETA_ERROR_" + status + "\",\"attempt\":{\"predictedEta\":null}}";
        RESPONSE.set(new StubResponse(status, payload, false));
        for (boolean history : new boolean[] {false, true}) {
            assertJson(uc016(history, API_KEY), status, payload);
            assertUc016Forwarded(history);
        }
    }

    @Test
    void uc016UnavailableFallbackPreservesNullFields() throws Exception {
        String payload = """
                {"voyageId":41,"predictedEta":null,"etaConfidence":null,"etaDeviationH":null,
                 "aiStatus":"UNAVAILABLE","modelVersion":null,"effectiveEta":"2026-11-20T10:00:00Z","failureReason":"TIMEOUT"}
                """;
        RESPONSE.set(new StubResponse(200, payload, false));
        assertJson(uc016(false, API_KEY), 200, payload);
        assertUc016Forwarded(false);
    }

    @ParameterizedTest
    @ValueSource(strings = {"{", "null", "[]"})
    void uc016MapsInvalidUpstreamJsonTo502(String payload) throws Exception {
        RESPONSE.set(new StubResponse(200, payload, false));
        assertEquals(502, uc016(false, API_KEY).statusCode());
    }

    @Test
    void uc016MapsServerAndConnectionFailureTo502AndRejectsMissingKeyAndBadCursor() throws Exception {
        RESPONSE.set(new StubResponse(500, "{\"internal\":\"private details\"}", false));
        assertEquals(502, uc016(false, API_KEY).statusCode());
        RESPONSE.set(new StubResponse(200, "", true));
        assertEquals(502, uc016(true, API_KEY).statusCode());
        REQUESTS.clear();
        assertEquals(401, uc016(false, null).statusCode());
        assertEquals(401, uc016(true, null).statusCode());
        var response = HTTP.send(request("/api/v1/voyages/41/eta-predictions?beforeId=0")
                .header("X-UC015-Key", API_KEY).GET().build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(400, response.statusCode());
        assertTrue(REQUESTS.isEmpty());
    }
}
