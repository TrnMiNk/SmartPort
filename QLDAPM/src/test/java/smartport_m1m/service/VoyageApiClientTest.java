package smartport_m1m.service;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.*;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;
import smartport_m1m.m1.dto.CreateArrivalNoticeRequest;

class VoyageApiClientTest {
    @Test void sendsCamelCaseJsonAndIdempotencyHeaderToNode() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo("http://localhost:5000/api/voyages"))
                .andExpect(method(org.springframework.http.HttpMethod.POST))
                .andExpect(header("Idempotency-Key", "arrival-1"))
                .andExpect(content().contentType(MediaType.APPLICATION_JSON))
                .andExpect(content().json("{\"vesselId\":3,\"voyageNo\":\"SP-2026-001\",\"declaredEta\":\"2026-11-12T03:30:00+07:00\",\"declaredTeu\":1800}"))
                .andRespond(withSuccess("{\"success\":true}", MediaType.APPLICATION_JSON));
        var client = new VoyageApiClient("http://localhost:5000", builder);
        var request = new CreateArrivalNoticeRequest(3L, "SP-2026-001", 1L, 1L,
                "2026-11-12T03:30:00+07:00", "container", 1800, null, null);
        assertTrue(Boolean.TRUE.equals(client.create(request, "arrival-1").get("success")));
        server.verify();
    }
}
