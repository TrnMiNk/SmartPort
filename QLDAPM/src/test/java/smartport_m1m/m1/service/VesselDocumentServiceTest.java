package smartport_m1m.m1.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.io.IOException;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.server.ResponseStatusException;

import smartport_m1m.m1.dto.ReviewVesselDocumentRequest;
import smartport_m1m.service.VesselDocumentApiClient;

class VesselDocumentServiceTest {

    private VesselDocumentApiClient apiClient;
    private VesselDocumentService service;

    @BeforeEach
    void setUp() {
        apiClient = mock(VesselDocumentApiClient.class);
        service = new VesselDocumentService(apiClient);
    }

    @Test
    void validUploadForwardsFileBytesWithoutChangingThem() throws IOException {
        byte[] pdf = "%PDF-1.7\nSmartPort".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
        MockMultipartFile file = new MockMultipartFile(
                "file", "vessel.pdf", "application/pdf", pdf);
        Map<String, Object> response = Map.of("success", true, "data", Map.of("id", 12));
        when(apiClient.upload(eq(3L), eq("Registry"), any(Resource.class),
                eq("vessel.pdf"), eq(org.springframework.http.MediaType.APPLICATION_PDF)))
                .thenReturn(response);

        assertSame(response, service.upload(3, " Registry ", file));
        var resourceCaptor = org.mockito.ArgumentCaptor.forClass(Resource.class);
        verify(apiClient).upload(eq(3L), eq("Registry"), resourceCaptor.capture(),
                eq("vessel.pdf"), eq(org.springframework.http.MediaType.APPLICATION_PDF));
        assertArrayEquals(pdf, resourceCaptor.getValue().getInputStream().readAllBytes());
    }

    @Test
    void uploadRejectsMissingEmptyOversizedAndUnsupportedFiles() {
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(ResponseStatusException.class,
                () -> service.upload(3, "Certificate", null)).getStatusCode());
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(ResponseStatusException.class,
                () -> service.upload(3, "Certificate",
                        new MockMultipartFile("file", "empty.pdf", "application/pdf", new byte[0])))
                .getStatusCode());
        assertEquals(HttpStatus.CONTENT_TOO_LARGE, assertThrows(ResponseStatusException.class,
                () -> service.upload(3, "Certificate",
                        new MockMultipartFile("file", "large.pdf", "application/pdf",
                                new byte[10 * 1024 * 1024 + 1])))
                .getStatusCode());
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(ResponseStatusException.class,
                () -> service.upload(3, "Certificate",
                        new MockMultipartFile("file", "script.exe", "application/octet-stream", new byte[]{1})))
                .getStatusCode());
        verifyNoInteractions(apiClient);
    }

    @Test
    void uploadRejectsFilenameWithoutExtension() {
        var file = new MockMultipartFile("file", "nodot", "application/pdf", "%PDF-1.7".getBytes());
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(ResponseStatusException.class,
                () -> service.upload(3, "Registry", file)).getStatusCode());
        verifyNoInteractions(apiClient);
    }

    @Test
    void listAndDownloadPreserveResultsAndBinaryBody() {
        Map<String, Object> listResponse = Map.of("success", true, "data", List.of());
        when(apiClient.list(3)).thenReturn(listResponse);
        assertSame(listResponse, service.list(3));

        byte[] bytes = new byte[]{0, 1, 2, (byte) 0xff, 10};
        ResponseEntity<byte[]> download = ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=doc.pdf")
                .body(bytes);
        when(apiClient.download(3, 9)).thenReturn(download);
        assertArrayEquals(bytes, service.download(3, 9).getBody());
        Map<String, Object> metadata = Map.of("success", true, "data", Map.of("id", 9));
        when(apiClient.metadata(3, 9)).thenReturn(metadata);
        assertSame(metadata, service.metadata(3, 9));
    }

    @Test
    void uploadMapsNodeValidationNotFoundAndSizeErrors() {
        MockMultipartFile file = new MockMultipartFile(
                "file", "vessel.pdf", "application/pdf", "%PDF-1.7".getBytes());
        for (HttpStatus status : List.of(HttpStatus.BAD_REQUEST,
                HttpStatus.NOT_FOUND, HttpStatus.CONTENT_TOO_LARGE)) {
            doThrow(new HttpClientErrorException(status))
                    .when(apiClient).upload(eq(3L), eq("Registry"), any(Resource.class),
                            eq("vessel.pdf"), eq(org.springframework.http.MediaType.APPLICATION_PDF));
            ResponseStatusException exception = assertThrows(ResponseStatusException.class,
                    () -> service.upload(3, "Registry", file));
            assertEquals(status.value(), exception.getStatusCode().value());
        }
    }

    @Test
    void upstreamStatusesAndConnectionFailuresAreMapped() {
        for (HttpStatus status : List.of(HttpStatus.BAD_REQUEST,
                HttpStatus.NOT_FOUND, HttpStatus.CONFLICT,
                HttpStatus.CONTENT_TOO_LARGE)) {
            doThrow(new HttpClientErrorException(status))
                    .when(apiClient).list(3);
            ResponseStatusException exception = assertThrows(ResponseStatusException.class,
                    () -> service.list(3));
            assertEquals(status.value(), exception.getStatusCode().value());
        }

        doThrow(new ResourceAccessException("connection refused"))
                .when(apiClient).list(3);
        assertEquals(HttpStatus.BAD_GATEWAY, assertThrows(ResponseStatusException.class,
                () -> service.list(3)).getStatusCode());
    }

    @Test
    void invalidReviewRequestIsRejectedAndValidReviewIsForwarded() {
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(ResponseStatusException.class,
                () -> service.review(3, 9,
                        new ReviewVesselDocumentRequest("REJECTED", " "))).getStatusCode());
        Map<String, Object> result = Map.of("success", true, "data", Map.of("id", 9));
        when(apiClient.review(3, 9, "APPROVED", null)).thenReturn(result);
        assertSame(result, service.review(3, 9,
                new ReviewVesselDocumentRequest("approved", null)));
    }
}
