package smartport_m1m.m1.controller;

import java.util.Map;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import smartport_m1m.m1.dto.PartnerArrivalNoticeRequest;
import smartport_m1m.m1.service.PartnerIntegrationService;

@RestController
@RequestMapping("/api/v1/integration")
public class PartnerIntegrationController {
    private final PartnerIntegrationService service;
    public PartnerIntegrationController(PartnerIntegrationService service) { this.service = service; }

    @PostMapping("/voyages")
    public ResponseEntity<Map<String,Object>> create(@Valid @RequestBody PartnerArrivalNoticeRequest request,
            @RequestHeader(name="X-API-Key", required=false) String apiKey,
            @RequestHeader(name="Idempotency-Key", required=false) String key) {
        Map<String,Object> result = service.create(request, apiKey, key);
        return ResponseEntity.status(Boolean.TRUE.equals(result.get("replayed")) ? HttpStatus.OK : HttpStatus.CREATED).body(result);
    }
}
