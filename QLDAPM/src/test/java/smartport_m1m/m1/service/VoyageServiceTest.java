package smartport_m1m.m1.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.server.ResponseStatusException;
import smartport_m1m.m1.dto.CreateArrivalNoticeRequest;
import smartport_m1m.service.VoyageApiClient;

class VoyageServiceTest {
    private final VoyageApiClient client = mock(VoyageApiClient.class);
    private final VoyageService service = new VoyageService(client);
    private final CreateArrivalNoticeRequest request = new CreateArrivalNoticeRequest(
            3L, "SP-2026-001", 1L, 1L, "2026-11-12T03:30:00+07:00",
            "container", 1800, null, 2);

    @Test void forwardsRequestAndIdempotencyKey() {
        when(client.create(request, "key-1")).thenReturn(Map.of("success", true));
        assertTrue(service.create(request, "key-1").get("success").equals(true));
        verify(client).create(request, "key-1");
    }

    @Test void rejectsMissingKeyAndTimezoneLessEta() {
        assertEquals(400, assertThrows(ResponseStatusException.class,
                () -> service.create(request, " ")).getStatusCode().value());
        var invalid = new CreateArrivalNoticeRequest(3L, "X", 1L, 1L,
                "2026-11-12T03:30:00", "container", 2, null, null);
        assertEquals(400, assertThrows(ResponseStatusException.class,
                () -> service.create(invalid, "key")).getStatusCode().value());
        verifyNoInteractions(client);
    }

    @Test void preservesNodeConflictStatusAndMapsUpstreamFailureTo502() {
        when(client.create(any(), anyString())).thenThrow(HttpClientErrorException.create(
                HttpStatus.CONFLICT, "Conflict", HttpHeaders.EMPTY,
                "{\"success\":false,\"existingVoyageId\":42}".getBytes(), null));
        var conflict = assertThrows(VoyageHttpException.class, () -> service.create(request, "key"));
        assertEquals(409, conflict.status());
        assertEquals(42, conflict.body().get("existingVoyageId"));
        when(client.get(1)).thenThrow(HttpServerErrorException.create(
                HttpStatus.INTERNAL_SERVER_ERROR, "Error", HttpHeaders.EMPTY, new byte[0], null));
        assertEquals(502, assertThrows(ResponseStatusException.class,
                () -> service.get(1)).getStatusCode().value());
    }
}
