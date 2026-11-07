package smartport_m1m.m1.service;

import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.server.ResponseStatusException;

import smartport_m1m.m1.dto.ReviewVesselDocumentRequest;
import smartport_m1m.service.VesselDocumentApiClient;

@Service
public class VesselDocumentService {

    private static final long MAX_FILE_SIZE = 10L * 1024 * 1024;
    private static final Map<String, String> ALLOWED_TYPES = Map.of(
            ".pdf", "application/pdf",
            ".jpg", "image/jpeg",
            ".jpeg", "image/jpeg",
            ".png", "image/png");

    private final VesselDocumentApiClient apiClient;

    public VesselDocumentService(VesselDocumentApiClient apiClient) {
        this.apiClient = apiClient;
    }

    public Map<String, Object> upload(long shipId, String documentType, MultipartFile file) {
        validateIds(shipId);
        if (documentType == null || documentType.isBlank() || documentType.trim().length() > 50) {
            throw badRequest("Loai tai lieu phai co tu 1 den 50 ky tu");
        }
        if (file == null || file.isEmpty()) {
            throw badRequest("Thieu file tai lieu");
        }
        if (file.getSize() > MAX_FILE_SIZE) {
            throw new ResponseStatusException(HttpStatus.CONTENT_TOO_LARGE,
                    "File vuot qua gioi han 10 MB");
        }
        String filename = file.getOriginalFilename();
        String contentType = file.getContentType();
        String extension = filename == null ? "" : filename.substring(filename.lastIndexOf('.')).toLowerCase();
        if (!ALLOWED_TYPES.containsKey(extension) ||
                !ALLOWED_TYPES.get(extension).equalsIgnoreCase(contentType)) {
            throw badRequest("Chi chap nhan PDF, JPG, JPEG hoac PNG");
        }

        return invoke(() -> apiClient.upload(shipId, documentType.trim(),
                file.getResource(), filename, MediaType.parseMediaType(contentType)),
                response -> Boolean.TRUE.equals(response.get("success")) &&
                        response.get("data") instanceof Map<?, ?>,
                "Phan hoi upload tai lieu tu Node.js khong hop le");
    }

    public Map<String, Object> list(long shipId) {
        validateIds(shipId);
        return invoke(() -> apiClient.list(shipId),
                response -> Boolean.TRUE.equals(response.get("success")) &&
                        response.get("data") instanceof List<?>,
                "Danh sach tai lieu tu Node.js khong hop le");
    }

    public Map<String, Object> metadata(long shipId, long documentId) {
        validateIds(shipId, documentId);
        return invoke(() -> apiClient.metadata(shipId, documentId),
                response -> Boolean.TRUE.equals(response.get("success")) &&
                        response.get("data") instanceof Map<?, ?>,
                "Metadata tai lieu tu Node.js khong hop le");
    }

    public ResponseEntity<byte[]> download(long shipId, long documentId) {
        validateIds(shipId, documentId);
        try {
            ResponseEntity<byte[]> response = apiClient.download(shipId, documentId);
            if (response == null || response.getBody() == null) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                        "Node.js khong tra ve noi dung tai lieu");
            }
            return response;
        } catch (RestClientResponseException exception) {
            throw mapUpstreamStatus(exception);
        } catch (RestClientException exception) {
            throw gatewayError(exception);
        }
    }

    public Map<String, Object> review(
            long shipId, long documentId, ReviewVesselDocumentRequest request) {
        validateIds(shipId, documentId);
        if (request == null || request.status() == null) {
            throw badRequest("Trang thai xet duyet khong hop le");
        }
        String status = request.status().trim().toUpperCase();
        String note = request.reviewNote();
        if (!List.of("APPROVED", "REJECTED").contains(status) ||
                (note != null && note.length() > 1000) ||
                ("REJECTED".equals(status) && (note == null || note.isBlank()))) {
            throw badRequest("Trang thai hoac ghi chu xet duyet khong hop le");
        }
        return invoke(() -> apiClient.review(shipId, documentId, status,
                        note == null ? null : note.trim()),
                response -> Boolean.TRUE.equals(response.get("success")) &&
                        response.get("data") instanceof Map<?, ?>,
                "Phan hoi xet duyet tai lieu tu Node.js khong hop le");
    }

    private <T> T invoke(
            ApiCall<T> call,
            java.util.function.Predicate<T> valid,
            String invalidResponseMessage) {
        try {
            T response = call.run();
            if (response == null || !valid.test(response)) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, invalidResponseMessage);
            }
            return response;
        } catch (RestClientResponseException exception) {
            throw mapUpstreamStatus(exception);
        } catch (RestClientException exception) {
            throw gatewayError(exception);
        }
    }

    private ResponseStatusException mapUpstreamStatus(RestClientResponseException exception) {
        int status = exception.getStatusCode().value();
        if (status == 400 || status == 404 || status == 409 || status == 413) {
            return new ResponseStatusException(HttpStatus.valueOf(status),
                    "Node.js tu choi yeu cau tai lieu", exception);
        }
        return gatewayError(exception);
    }

    private ResponseStatusException gatewayError(Exception exception) {
        return new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                "Khong the ket noi Node.js API tai lieu", exception);
    }

    private void validateIds(long... ids) {
        for (long id : ids) {
            if (id <= 0 || id > Integer.MAX_VALUE) {
                throw badRequest("ID tau hoac tai lieu khong hop le");
            }
        }
    }

    private ResponseStatusException badRequest(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }

    @FunctionalInterface
    private interface ApiCall<T> {
        T run();
    }
}
