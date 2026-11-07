
package smartport_m1m.m1.controller;

import java.util.Map;

import jakarta.validation.Valid;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import smartport_m1m.m1.dto.CreateVesselRequest;
import smartport_m1m.m1.service.VesselService;
import smartport_m1m.m1.dto.UpdateVesselRequest;
import smartport_m1m.m1.dto.DeactivateVesselRequest;

@RestController
@RequestMapping("/api/v1/vessels")
public class VesselController {

    private final VesselService vesselService;

    public VesselController(VesselService vesselService) {
        this.vesselService = vesselService;
    }

    // Chi kiem tra du lieu, khong luu
    @PostMapping("/validate")
    public ResponseEntity<Map<String, Object>> validateVessel(
            @Valid @RequestBody CreateVesselRequest request) {

        vesselService.validateShipCode(request.shipCode());

        return ResponseEntity.ok(Map.of(
            "success", true,
            "message", "Du lieu ho so tau hop le",
            "imoNumber", request.imoNumber()
        ));
    }

    // UC-010: Tao ho so tau va luu vao database
    @PostMapping
    public ResponseEntity<Map<String, Object>> createVessel(
            @Valid @RequestBody CreateVesselRequest request) {

        Map<String, Object> result =
                vesselService.createVessel(request);

        return ResponseEntity
                .status(HttpStatus.CREATED)
                .body(result);
    }
    
    // UC-011: Xem chi tiet ho so tau
    @GetMapping("/{id}")
    public ResponseEntity<Map<String, Object>> getVesselById(
            @PathVariable long id) {

        Map<String, Object> result =
                vesselService.getVesselById(id);

        return ResponseEntity.ok(result);
    }

    // UC-011: Tim kiem tau theo ma, ten hoac IMO
    @GetMapping("/search")
    public ResponseEntity<Map<String, Object>> searchVessels(
            @RequestParam(name = "q", required = false)
            String keyword) {

        Map<String, Object> result =
                vesselService.searchVessels(keyword);

        return ResponseEntity.ok(result);
    }

// UC-011: Cap nhat thong tin tau
@PutMapping("/{id}")
public ResponseEntity<Map<String, Object>> updateVessel(
        @PathVariable long id,
        @Valid @RequestBody UpdateVesselRequest request) {

    Map<String, Object> result =
            vesselService.updateVessel(id, request);

    return ResponseEntity.ok(result);
}

// UC-011: Ngung su dung tau
@PatchMapping("/{id}/deactivate")
public ResponseEntity<Map<String, Object>> deactivateVessel(
        @PathVariable long id,
        @Valid @RequestBody DeactivateVesselRequest request) {

    Map<String, Object> result =
            vesselService.deactivateVessel(id, request.reason());

    return ResponseEntity.ok(result);
}

}
